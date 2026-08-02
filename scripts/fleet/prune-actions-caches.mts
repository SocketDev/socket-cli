#!/usr/bin/env node
/*
 * @file Keep a repo's GitHub Actions cache under budget. GitHub caps Actions
 *   cache at 10 GB per repo and evicts LEAST-RECENTLY-USED entries once the cap
 *   is hit — so a repo that runs over does not fail, it silently throws away the
 *   entries it needs most often, and every job re-downloads and rebuilds from
 *   scratch. That is what "the cache busts" looks like from the outside: no
 *   error, just jobs that got slow again.
 *
 *   Two passes, in order:
 *
 *   1. PER-GROUP retention — group entries by key prefix (the cache key minus
 *      its trailing content hash, which is what `hashFiles()` appends) and keep
 *      the newest `--keep N` per group by last-access. A group is one logical
 *      cache whose hash rolls every time its inputs change, so the stale
 *      generations behind the newest are pure dead weight.
 *   2. BUDGET enforcement — if the survivors still exceed `--max-bytes`, drop
 *      the least-recently-accessed of them until they fit, but never touch a
 *      FRESH entry (accessed within `--fresh-days` of the newest access in the
 *      inventory). Recency is the only signal available for "a job is about to
 *      restore this", and evicting a hot cache causes exactly the cold rebuild
 *      the budget exists to prevent. This is the same LRU order GitHub applies
 *      at the ceiling — done deliberately, on a schedule, instead of at whatever
 *      moment the repo happens to tip over.
 *
 *   Fails LOUD when the budget is unreachable — when the fresh set alone is over
 *   budget, no amount of pruning fixes it and the caches themselves need to
 *   shrink. It never reports a green sweep it did not achieve.
 *
 *   Usage: node scripts/fleet/prune-actions-caches.mts
 *     [--all | --repo owner/name] [--keep N] [--max-bytes N]
 *     [--fresh-days N] [--dry-run]
 *   Auth: `gh` (GITHUB_TOKEN in CI, keychain locally); needs `actions: write`.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  fleetReposPath,
  parseFleetRepos,
} from './check/member-ci-fires-on-push.mts'
import { REPO_ROOT } from './paths.mts'
import { runCapture } from './publish-infra/shared.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { resolveRepoSlug } from './prune-workflow-runs.mts'
import { runMain } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const BYTES_PER_GB = 1024 ** 3
// GitHub's hard per-repo Actions cache cap. Past this, GitHub evicts LRU
// entries on its own — the state this script exists to keep the repo out of.
const CACHE_CEILING_BYTES = 10 * BYTES_PER_GB
// Repos pruned concurrently in `--all` mode, matching prune-workflow-runs:
// modest, so the shared token's secondary rate limit backs off rather than
// stalling every worker at once.
const CONCURRENCY = 3
// Default freshness window, in days before the newest access in the inventory.
// An entry touched inside it is treated as live and is never evicted for
// budget: a week covers a normal cadence of pushes plus a quiet weekend.
const FRESH_DAYS_DEFAULT = 7
// Default retention per key group. One live generation plus one to fall back
// on; a third is already older than any input the group hashes.
const KEEP_DEFAULT = 2
const MS_PER_DAY = 86_400_000
// Default budget: 80% of the ceiling. The headroom matters because a sweep
// runs weekly while caches are written continuously — pruning exactly TO the
// ceiling leaves the repo one build away from eviction again.
const MAX_BYTES_DEFAULT = 8 * BYTES_PER_GB
// A cache key's trailing content hash, as `hashFiles()` renders it. Only a
// final all-hex run of 8+ chars counts, so a key ending in a version or a
// platform name keeps its last segment and stays its own group.
const TRAILING_HASH_RE = /^[0-9a-f]{8,}$/i

export interface CacheEntry {
  id: number
  key: string
  lastAccessedAt: number
  ref: string
  sizeInBytes: number
}

export interface CachePolicy {
  freshDays: number
  keep: number
  maxBytes: number
}

export interface CacheSelection {
  doomed: CacheEntry[]
  // True when the FRESH set alone already exceeds the budget, so pruning cannot
  // reach it. The caller reports this loud instead of claiming success.
  budgetUnreachable: boolean
  projectedBytes: number
  totalBytes: number
}

export interface PruneCachesConfig {
  dryRun: boolean
  policy: CachePolicy
}

export interface PruneCachesResult {
  deleted: number
  failed: number
  ok: boolean
  reclaimedBytes: number
}

/**
 * The group a cache key belongs to: the key minus its trailing content hash.
 *
 * `actions/cache` keys conventionally end in a `hashFiles()` digest that rolls
 * whenever the hashed inputs change, so `Linux-cargo-a1b2c3d4e5` and
 * `Linux-cargo-f6e5d4c3b2` are two generations of ONE logical cache. Grouping
 * on the prefix is what lets retention keep the live generation and drop the
 * dead ones. A key with no hash suffix groups under itself.
 */
export function cacheKeyPrefix(key: string): string {
  const cut = key.lastIndexOf('-')
  if (cut <= 0) {
    return key
  }
  return TRAILING_HASH_RE.test(key.slice(cut + 1)) ? key.slice(0, cut) : key
}

/**
 * Group entries by key prefix, each group sorted newest-first by last access.
 * Ties break on id so the ordering is deterministic — two entries can share a
 * last-access timestamp at second granularity, and an unstable sort there would
 * make the retention decision differ run to run.
 */
export function groupCachesByPrefix(
  caches: readonly CacheEntry[],
): Map<string, CacheEntry[]> {
  const groups = new Map<string, CacheEntry[]>()
  for (let i = 0, { length } = caches; i < length; i += 1) {
    const entry = caches[i]!
    const prefix = cacheKeyPrefix(entry.key)
    const group = groups.get(prefix)
    if (group) {
      group.push(entry)
    } else {
      groups.set(prefix, [entry])
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt || b.id - a.id)
  }
  return groups
}

/**
 * The freshness cutoff: entries accessed at or after this are treated as live.
 *
 * Measured back from the NEWEST access in the inventory, not from wall-clock
 * now. That keeps the decision pure and reproducible — the same inventory
 * always yields the same verdict, in a test or six months later — and it
 * degrades sensibly on a dormant repo, where every entry is old in absolute
 * terms but the most recent ones are still the live set.
 */
export function freshnessCutoff(
  caches: readonly CacheEntry[],
  freshDays: number,
): number {
  let newest = 0
  for (let i = 0, { length } = caches; i < length; i += 1) {
    const { lastAccessedAt } = caches[i]!
    if (lastAccessedAt > newest) {
      newest = lastAccessedAt
    }
  }
  return newest - freshDays * MS_PER_DAY
}

/**
 * The full retention decision, pure — no gh/network access.
 *
 * Pass 1 dooms everything past `policy.keep` in each group. Pass 2 dooms the
 * least-recently-accessed survivors until the total fits `policy.maxBytes`,
 * skipping any entry inside the freshness window. When the fresh set alone is
 * over budget, `budgetUnreachable` says so rather than evicting a live cache
 * and reporting a false green.
 */
export function selectCachesToDelete(
  caches: readonly CacheEntry[],
  policy: CachePolicy,
): CacheSelection {
  const groups = groupCachesByPrefix(caches)
  const doomed: CacheEntry[] = []
  const survivors: CacheEntry[] = []
  let totalBytes = 0
  for (let i = 0, { length } = caches; i < length; i += 1) {
    totalBytes += caches[i]!.sizeInBytes
  }
  for (const group of groups.values()) {
    for (let i = 0, { length } = group; i < length; i += 1) {
      const entry = group[i]!
      if (i < policy.keep) {
        survivors.push(entry)
      } else {
        doomed.push(entry)
      }
    }
  }
  let projectedBytes = 0
  for (let i = 0, { length } = survivors; i < length; i += 1) {
    projectedBytes += survivors[i]!.sizeInBytes
  }
  if (projectedBytes <= policy.maxBytes) {
    return { budgetUnreachable: false, doomed, projectedBytes, totalBytes }
  }
  // Over budget: evict the coldest STALE survivors, oldest access first, until
  // it fits. Fresh entries are off-limits — see freshnessCutoff.
  const cutoff = freshnessCutoff(caches, policy.freshDays)
  const evictable = survivors
    .filter(entry => entry.lastAccessedAt < cutoff)
    .toSorted((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.id - b.id)
  for (
    let i = 0, { length } = evictable;
    i < length && projectedBytes > policy.maxBytes;
    i += 1
  ) {
    const entry = evictable[i]!
    doomed.push(entry)
    projectedBytes -= entry.sizeInBytes
  }
  return {
    budgetUnreachable: projectedBytes > policy.maxBytes,
    doomed,
    projectedBytes,
    totalBytes,
  }
}

/**
 * Render a byte count as GB with two decimals, for the budget report.
 */
export function formatGb(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`
}

/**
 * Parse the raw `--keep` value: a non-negative integer, else undefined.
 */
export function resolveKeepCount(rawKeep: string): number | undefined {
  const keep = Number(rawKeep)
  return Number.isInteger(keep) && keep >= 0 ? keep : undefined
}

/**
 * Parse the raw `--max-bytes` value. Accepts a plain byte count or a `gb`/`mb`
 * suffix, since the budget is naturally written in GB. Returns undefined for
 * anything non-positive so the caller fails loud instead of pruning to zero.
 */
export function resolveMaxBytes(rawMax: string): number | undefined {
  // The alternation is alphabetized per socket/sort-regex-alternations; the `$`
  // anchor keeps `b` from short-circuiting a `gb`/`mb` suffix.
  const match = /^(\d+(?:\.\d+)?)\s*(b|gb|mb)?$/i.exec(rawMax.trim())
  if (!match) {
    return undefined
  }
  const value = Number(match[1])
  const unit = (match[2] ?? 'b').toLowerCase()
  const scale = unit === 'gb' ? BYTES_PER_GB : unit === 'mb' ? 1024 ** 2 : 1
  const bytes = value * scale
  return bytes > 0 ? bytes : undefined
}

export async function listCaches(
  repo: string,
): Promise<CacheEntry[] | undefined> {
  const r = await runCapture(
    'gh',
    [
      'api',
      '--paginate',
      `/repos/${repo}/actions/caches?per_page=100`,
      '--jq',
      '.actions_caches[] | "\\(.id)\\t\\(.key)\\t\\(.ref)\\t\\(.size_in_bytes)\\t\\(.last_accessed_at)"',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    return undefined
  }
  const out: CacheEntry[] = []
  const lines = r.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line) {
      continue
    }
    const {
      0: idRaw,
      1: key,
      2: ref,
      3: sizeRaw,
      4: accessedRaw,
    } = line.split('\t')
    const id = Number(idRaw)
    const sizeInBytes = Number(sizeRaw)
    const lastAccessedAt = Date.parse(accessedRaw ?? '')
    if (Number.isFinite(id) && key) {
      out.push({
        id,
        key,
        lastAccessedAt: Number.isFinite(lastAccessedAt) ? lastAccessedAt : 0,
        ref: ref ?? '',
        sizeInBytes: Number.isFinite(sizeInBytes) ? sizeInBytes : 0,
      })
    }
  }
  return out
}

export async function deleteCache(
  repo: string,
  cacheId: number,
): Promise<boolean> {
  const r = await runCapture(
    'gh',
    ['api', '-X', 'DELETE', `/repos/${repo}/actions/caches/${cacheId}`],
    REPO_ROOT,
  )
  return r.code === 0
}

/**
 * Prune one repo's caches and report the outcome against the budget. Unlike the
 * run pruner this needs no repeat rounds: the caches endpoint paginates the
 * full inventory, so one listing sees everything.
 */
export async function pruneRepoCaches(
  repo: string,
  config: PruneCachesConfig,
): Promise<PruneCachesResult> {
  const cfg = { __proto__: null, ...config } as PruneCachesConfig
  const result: PruneCachesResult = {
    deleted: 0,
    failed: 0,
    ok: true,
    reclaimedBytes: 0,
  }
  const caches = await listCaches(repo)
  if (!caches) {
    logger.fail(
      `[${repo}] Listing caches failed (gh api /repos/${repo}/actions/caches). Wanted the cache inventory; check access/auth (needs actions: write), then re-run.`,
    )
    result.ok = false
    return result
  }
  const selection = selectCachesToDelete(caches, cfg.policy)
  logger.log(
    `[${repo}] ${caches.length} cache(s), ${formatGb(selection.totalBytes)} of ${formatGb(CACHE_CEILING_BYTES)} ceiling; ${selection.doomed.length} to prune.`,
  )
  if (cfg.dryRun) {
    for (let i = 0, { length } = selection.doomed; i < length; i += 1) {
      const entry = selection.doomed[i]!
      logger.log(
        `[${repo}]   would delete ${entry.key} (${formatGb(entry.sizeInBytes)}, ref ${entry.ref})`,
      )
    }
  } else {
    for (let i = 0, { length } = selection.doomed; i < length; i += 1) {
      const entry = selection.doomed[i]!
      if (await deleteCache(repo, entry.id)) {
        result.deleted += 1
        result.reclaimedBytes += entry.sizeInBytes
      } else {
        result.failed += 1
      }
    }
  }
  const verb = cfg.dryRun ? 'would leave' : 'leaves'
  logger.log(
    `[${repo}] ${verb} ${formatGb(selection.projectedBytes)} against a ${formatGb(cfg.policy.maxBytes)} budget.`,
  )
  if (selection.budgetUnreachable) {
    logger.fail(
      `[${repo}] Still over budget after pruning: ${formatGb(selection.projectedBytes)} > ${formatGb(cfg.policy.maxBytes)}. ` +
        `Every remaining entry was accessed within the ${cfg.policy.freshDays}-day freshness window, so pruning cannot go further without evicting a live cache. ` +
        `Fix: shrink what the workflows cache (narrower paths, split keys), or raise --max-bytes if the ${formatGb(CACHE_CEILING_BYTES)} ceiling still has room.`,
    )
    result.ok = false
  }
  if (result.failed > 0) {
    logger.warn(
      `[${repo}] ${result.failed} delete(s) failed; re-run to retry those.`,
    )
  }
  return result
}

function printHelp(): void {
  logger.log('Usage: node scripts/fleet/prune-actions-caches.mts [options]')
  logger.log('')
  logger.log(
    '  --all             prune every fleet roster repo (needs fleet-repos.json)',
  )
  logger.log('  --repo o/name     prune one repo (default: the current clone)')
  logger.log(
    `  --keep N          keep the newest N entries per key group (default ${KEEP_DEFAULT})`,
  )
  logger.log(
    `  --max-bytes N     budget, plain bytes or a gb/mb suffix (default ${formatGb(MAX_BYTES_DEFAULT)})`,
  )
  logger.log(
    `  --fresh-days N    never evict an entry accessed within N days (default ${FRESH_DAYS_DEFAULT})`,
  )
  logger.log(
    '  --dry-run         report what would be deleted without deleting',
  )
}

async function resolveTargetRepos(config: {
  all: boolean
  repo: string | undefined
}): Promise<string[] | undefined> {
  const cfg = { __proto__: null, ...config } as {
    all: boolean
    repo: string | undefined
  }
  if (cfg.all) {
    const rosterPath = fleetReposPath(REPO_ROOT)
    if (!existsSync(rosterPath)) {
      logger.fail(
        `No fleet roster at ${rosterPath}. --all needs the cascaded fleet-repos.json; use --repo owner/name here.`,
      )
      return undefined
    }
    return parseFleetRepos(readFileSync(rosterPath, 'utf8')).map(
      entry => `${entry.owner}/${entry.name}`,
    )
  }
  if (cfg.repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) {
      logger.fail(
        `Invalid --repo value "${cfg.repo}". Wanted owner/name; fix the flag and re-run.`,
      )
      return undefined
    }
    return [cfg.repo]
  }
  const detected = await resolveRepoSlug()
  if (!detected) {
    logger.fail(
      'Could not resolve owner/repo (set GITHUB_REPOSITORY, pass --repo, or run inside a GitHub clone).',
    )
    return undefined
  }
  return [detected]
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      all: { default: false, type: 'boolean' },
      'dry-run': { default: false, type: 'boolean' },
      'fresh-days': { type: 'string' },
      help: { default: false, type: 'boolean' },
      keep: { type: 'string' },
      'max-bytes': { type: 'string' },
      repo: { type: 'string' },
    },
    strict: false,
  })
  if (values['help']) {
    printHelp()
    return
  }
  const dryRun = !!values['dry-run']
  let keep = KEEP_DEFAULT
  const rawKeep =
    typeof values['keep'] === 'string' ? values['keep'] : undefined
  if (rawKeep !== undefined) {
    const parsed = resolveKeepCount(rawKeep)
    if (parsed === undefined) {
      logger.fail(
        `Invalid --keep value "${rawKeep}". Wanted a non-negative integer; fix the flag and re-run.`,
      )
      process.exitCode = 1
      return
    }
    keep = parsed
  }
  let maxBytes = MAX_BYTES_DEFAULT
  const rawMax =
    typeof values['max-bytes'] === 'string' ? values['max-bytes'] : undefined
  if (rawMax !== undefined) {
    const parsed = resolveMaxBytes(rawMax)
    if (parsed === undefined) {
      logger.fail(
        `Invalid --max-bytes value "${rawMax}". Wanted a positive byte count, optionally suffixed gb/mb; fix the flag and re-run.`,
      )
      process.exitCode = 1
      return
    }
    maxBytes = parsed
  }
  let freshDays = FRESH_DAYS_DEFAULT
  const rawFresh =
    typeof values['fresh-days'] === 'string' ? values['fresh-days'] : undefined
  if (rawFresh !== undefined) {
    const parsed = resolveKeepCount(rawFresh)
    if (parsed === undefined) {
      logger.fail(
        `Invalid --fresh-days value "${rawFresh}". Wanted a non-negative integer; fix the flag and re-run.`,
      )
      process.exitCode = 1
      return
    }
    freshDays = parsed
  }
  const policy: CachePolicy = { freshDays, keep, maxBytes }

  const repos = await resolveTargetRepos({
    all: !!values['all'],
    repo: typeof values['repo'] === 'string' ? values['repo'] : undefined,
  })
  if (!repos) {
    process.exitCode = 1
    return
  }

  logger.log(
    `Pruning caches in ${repos.length} repo(s): keep newest ${keep} per key group, budget ${formatGb(maxBytes)}${dryRun ? ' [dry-run]' : ''}.`,
  )

  const failedRepos: string[] = []
  let totalDeleted = 0
  let totalReclaimed = 0
  let next = 0
  const width = Math.min(CONCURRENCY, repos.length)
  const workers: Array<Promise<void>> = []
  for (let w = 0; w < width; w += 1) {
    workers.push(
      (async () => {
        while (next < repos.length) {
          const repo = repos[next]!
          next += 1
          try {
            const result = await pruneRepoCaches(repo, { dryRun, policy })
            totalDeleted += result.deleted
            totalReclaimed += result.reclaimedBytes
            if (!result.ok) {
              failedRepos.push(repo)
            }
          } catch (e) {
            logger.error(`[${repo}] ${errorMessage(e)}`)
            failedRepos.push(repo)
          }
        }
      })(),
    )
  }
  await Promise.all(workers)

  if (dryRun) {
    logger.success(
      `Dry-run across ${repos.length} repo(s); re-run without --dry-run to delete.`,
    )
  } else {
    logger.success(
      `Pruned ${totalDeleted} cache(s), reclaiming ${formatGb(totalReclaimed)} across ${repos.length} repo(s).`,
    )
  }
  if (failedRepos.length > 0) {
    logger.fail(
      `Cache pruning incomplete for ${joinAnd(failedRepos.toSorted())}. Re-run for those repos.`,
    )
    process.exitCode = 1
  }
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main)
}
/* c8 ignore stop */
