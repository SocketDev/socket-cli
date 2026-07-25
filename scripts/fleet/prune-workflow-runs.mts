#!/usr/bin/env node
/*
 * @file Prune GitHub Actions workflow runs by the fleet retention policy:
 *
 *   - PURGED workflow — path or display name matches a purge pattern
 *     (built-in: `dynamic/dependabot/`, `gh-audit-*`; extend with `--purge`):
 *     every run is deleted, even when the source is on the default branch.
 *   - Workflow whose source is ABSENT from the default branch (deleted file,
 *     an org-managed dynamic workflow, or an orphaned run group): every run
 *     is deleted.
 *   - Workflow whose source EXISTS on the default branch: keep the newest
 *     `--keep N` runs (default 20); with `--days N`, also delete runs older
 *     than the window. When both flags are given the deletions union.
 *
 *   Targets the current clone by default, any repo via `--repo owner/name`,
 *   or every fleet roster member via `--all` (needs the cascaded
 *   fleet-repos.json). Each repo loops list-then-delete rounds until a round
 *   finds nothing to prune, so API-capped run listings still converge.
 *
 *   Deletes are paced + exponentially backed off: GitHub's SECONDARY rate
 *   limit 403-throttles rapid run-deletes (separate from the primary quota),
 *   so a tight loop stalls.
 *
 *   Usage: node scripts/fleet/prune-workflow-runs.mts
 *     [--all | --repo owner/name] [--keep N] [--days N] [--purge <glob>]
 *     [--dry-run]
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
import { createBackoff, sleep } from './_shared/backoff.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Repos pruned concurrently in `--all` mode — modest, so the shared token's
// secondary rate limit backs off instead of stalling every worker at once.
const CONCURRENCY = 3
const INITIAL_BACKOFF_MS = 15_000
const KEEP_DEFAULT = 20
const MAX_BACKOFF_MS = 300_000
// Safety bound on prune rounds per repo; a repo still finding doomed runs at
// the bound is reported loud, never silently left partial.
const MAX_PASSES = 50
const MS_PER_DAY = 86_400_000
const PACE_MS = 1500
// Run groups purged wholesale regardless of source presence: the Dependabot
// dynamic workflows (update-graph / dependabot-updates) and the retired
// gh-audit-* audit workflows.
const PURGE_PATTERNS_DEFAULT = ['dynamic/dependabot/', 'gh-audit-*']
// A refusals-only round (every remaining doomed run refused deletion — the
// in-progress-run shape) waits out the grace delay and retries, up to this
// many consecutive dry rounds, so runs that finish mid-sweep still get
// pruned instead of waiting a whole cadence week. The delay doubles each
// consecutive dry round (3m, 6m, …), giving longer runs a real chance to
// finish without stalling the sweep worker indefinitely.
const REFUSED_RETRIES = 3
const REFUSED_RETRY_DELAY_MS = 180_000
const RETENTION_DAYS_DEFAULT = 15

export interface WorkflowEntry {
  id: number
  name: string
  path: string
}

export interface RunEntry {
  createdAt: number
  id: number
  workflowId: number
}

export type SourcePresence = 'absent' | 'error' | 'present'

export type WorkflowStatus = 'absent' | 'present' | 'purged'

export interface RetentionPolicy {
  cutoff: number | undefined
  keep: number | undefined
}

export interface PruneRepoConfig {
  dryRun: boolean
  policy: RetentionPolicy
  purgeMatch: (workflow: WorkflowEntry) => boolean
}

export interface PruneRepoResult {
  deleted: number
  failed: number
  ok: boolean
  planned: number
}

// Compile a case-insensitive matcher from a `*`-wildcard pattern. The match
// is unanchored, so a plain substring works without wildcards.
export function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('*')
    .map(part => part.replace(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`))
    .join('.*')
  return new RegExp(source, 'i')
}

// True when the workflow's path or display name matches any purge pattern.
export function buildPurgeMatcher(
  patterns: readonly string[],
): (workflow: WorkflowEntry) => boolean {
  const regexps = patterns.map(globToRegExp)
  return workflow =>
    regexps.some(re => re.test(workflow.path) || re.test(workflow.name))
}

// Resolve the effective retention window in days from the raw `--days` CLI
// value: a finite positive number wins, anything else (absent/NaN/<=0) falls
// back to the default.
export function resolveRetentionDays(rawDays: string | undefined): number {
  const days = Number(rawDays ?? RETENTION_DAYS_DEFAULT)
  return Number.isFinite(days) && days > 0 ? days : RETENTION_DAYS_DEFAULT
}

// Parse the raw `--keep` CLI value: a non-negative integer wins, anything
// else is invalid and returns undefined so the caller can fail loud.
export function resolveKeepCount(rawKeep: string): number | undefined {
  const keep = Number(rawKeep)
  return Number.isInteger(keep) && keep >= 0 ? keep : undefined
}

export function computeCutoff(retentionDays: number, now: number): number {
  return now - retentionDays * MS_PER_DAY
}

// The retention decision, pure — no gh/network access. Purged and absent
// workflows (and orphaned run groups missing from the status map) lose every
// run; a present workflow keeps its newest `policy.keep` runs, minus any
// that predate `policy.cutoff`.
export function selectRunsToDelete(
  runs: readonly RunEntry[],
  statusById: ReadonlyMap<number, WorkflowStatus>,
  policy: RetentionPolicy,
): number[] {
  const groups = new Map<number, RunEntry[]>()
  for (let i = 0, { length } = runs; i < length; i += 1) {
    const run = runs[i]!
    const group = groups.get(run.workflowId)
    if (group) {
      group.push(run)
    } else {
      groups.set(run.workflowId, [run])
    }
  }
  const doomed: number[] = []
  for (const { 0: workflowId, 1: group } of groups) {
    const status = statusById.get(workflowId) ?? 'absent'
    if (status !== 'present') {
      for (let i = 0, { length } = group; i < length; i += 1) {
        doomed.push(group[i]!.id)
      }
      continue
    }
    group.sort((a, b) => b.createdAt - a.createdAt)
    for (let i = 0, { length } = group; i < length; i += 1) {
      const run = group[i]!
      const beyondCount = policy.keep !== undefined && i >= policy.keep
      const expired =
        policy.cutoff !== undefined && run.createdAt < policy.cutoff
      if (beyondCount || expired) {
        doomed.push(run.id)
      }
    }
  }
  return doomed
}

export async function resolveRepoSlug(): Promise<string | undefined> {
  const fromEnv = process.env['GITHUB_REPOSITORY']
  if (fromEnv) {
    return fromEnv
  }
  const r = await runCapture('git', ['remote', 'get-url', 'origin'], REPO_ROOT)
  if (r.code !== 0) {
    return undefined
  }
  // Capture "owner/repo" from an https or ssh GitHub remote URL, dropping an
  // optional `.git` suffix and any trailing whitespace.
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(r.stdout)
  return match?.[1]
}

// Resolve the default branch, or undefined when the repo read fails — the
// caller must abort rather than guess: a wrong branch makes every workflow
// look absent, which would doom every run.
export async function resolveDefaultBranch(
  repo: string,
): Promise<string | undefined> {
  const r = await runCapture(
    'gh',
    ['api', `/repos/${repo}`, '--jq', '.default_branch'],
    REPO_ROOT,
  )
  const branch = r.stdout.trim()
  return r.code === 0 && branch ? branch : undefined
}

// Whether the workflow source file exists on the branch. Only an explicit
// HTTP 404 body counts as absent; any other failure (rate limit, network)
// reports 'error' so the caller aborts instead of dooming live runs.
export async function sourceExistsOnBranch(
  repo: string,
  filePath: string,
  branch: string,
): Promise<SourcePresence> {
  const r = await runCapture(
    'gh',
    [
      'api',
      `/repos/${repo}/contents/${filePath}?ref=${branch}`,
      '--jq',
      '.sha',
    ],
    REPO_ROOT,
  )
  if (r.code === 0 && !!r.stdout.trim()) {
    return 'present'
  }
  return /"status"\s*:\s*"404"/.test(r.stdout) ? 'absent' : 'error'
}

export async function listWorkflows(
  repo: string,
): Promise<WorkflowEntry[] | undefined> {
  const r = await runCapture(
    'gh',
    [
      'api',
      '--paginate',
      `/repos/${repo}/actions/workflows`,
      '--jq',
      '.workflows[] | "\\(.id)\\t\\(.path)\\t\\(.name)"',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    return undefined
  }
  const out: WorkflowEntry[] = []
  const lines = r.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line) {
      continue
    }
    const { 0: idRaw, 1: path, 2: name } = line.split('\t')
    const id = Number(idRaw)
    if (Number.isFinite(id) && path) {
      out.push({ id, name: name ?? '', path })
    }
  }
  return out
}

export async function listAllRuns(
  repo: string,
): Promise<RunEntry[] | undefined> {
  const r = await runCapture(
    'gh',
    [
      'api',
      '--paginate',
      `/repos/${repo}/actions/runs?per_page=100`,
      '--jq',
      '.workflow_runs[] | "\\(.id)\\t\\(.workflow_id)\\t\\(.created_at)"',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    return undefined
  }
  const out: RunEntry[] = []
  const lines = r.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line) {
      continue
    }
    const { 0: idRaw, 1: wfRaw, 2: createdRaw } = line.split('\t')
    const id = Number(idRaw)
    const workflowId = Number(wfRaw)
    const createdAt = Date.parse(createdRaw ?? '')
    if (Number.isFinite(id) && Number.isFinite(workflowId)) {
      out.push({
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        id,
        workflowId,
      })
    }
  }
  return out
}

export async function deleteRun(
  repo: string,
  runId: number,
): Promise<'deleted' | 'throttled' | 'failed'> {
  const r = await runCapture(
    'gh',
    ['api', '-X', 'DELETE', `/repos/${repo}/actions/runs/${runId}`],
    REPO_ROOT,
  )
  if (r.code === 0) {
    return 'deleted'
  }
  return /rate limit|secondary|abuse|retry/i.test(r.stdout)
    ? 'throttled'
    : 'failed'
}

// Prune one repo: classify each workflow (purged / present / absent), select
// doomed runs, remove them paced, and repeat until a round finds nothing —
// the API caps run listings, so one round may not see the whole backlog.
export async function pruneRepo(
  repo: string,
  config: PruneRepoConfig,
): Promise<PruneRepoResult> {
  const cfg = { __proto__: null, ...config } as PruneRepoConfig
  const result: PruneRepoResult = {
    deleted: 0,
    failed: 0,
    ok: true,
    planned: 0,
  }
  const branch = await resolveDefaultBranch(repo)
  if (!branch) {
    logger.fail(
      `[${repo}] Could not read the repo (gh api /repos/${repo} failed). Wanted its default branch; check access/auth, then re-run.`,
    )
    result.ok = false
    return result
  }
  // Source-presence memo, shared across rounds — the workflow inventory
  // barely changes between rounds, so each path is verified once.
  const presenceByPath = new Map<string, SourcePresence>()
  const grace = createBackoff(REFUSED_RETRY_DELAY_MS)
  let dryRounds = 0
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const workflows = await listWorkflows(repo)
    if (!workflows) {
      logger.fail(
        `[${repo}] Listing workflows failed (gh api /repos/${repo}/actions/workflows). Wanted the workflow inventory; check access/rate limit, then re-run.`,
      )
      result.ok = false
      return result
    }
    const statusById = new Map<number, WorkflowStatus>()
    for (let i = 0, { length } = workflows; i < length; i += 1) {
      const workflow = workflows[i]!
      if (cfg.purgeMatch(workflow)) {
        statusById.set(workflow.id, 'purged')
        continue
      }
      let presence = presenceByPath.get(workflow.path)
      if (presence === undefined) {
        presence = await sourceExistsOnBranch(repo, workflow.path, branch)
        presenceByPath.set(workflow.path, presence)
      }
      if (presence === 'error') {
        logger.fail(
          `[${repo}] Could not verify ${workflow.path} on ${branch} (non-404 gh api failure). Wanted present-or-404; check rate limit/auth, then re-run.`,
        )
        result.ok = false
        return result
      }
      statusById.set(workflow.id, presence)
    }
    if (pass === 1) {
      for (let i = 0, { length } = workflows; i < length; i += 1) {
        const workflow = workflows[i]!
        logger.log(
          `[${repo}]   ${workflow.path}: ${statusById.get(workflow.id)}`,
        )
      }
    }
    const runs = await listAllRuns(repo)
    if (!runs) {
      logger.fail(
        `[${repo}] Listing runs failed (gh api /repos/${repo}/actions/runs). Wanted the run inventory; check access/rate limit, then re-run.`,
      )
      result.ok = false
      return result
    }
    const doomed = selectRunsToDelete(runs, statusById, cfg.policy)
    logger.log(
      `[${repo}] round ${pass}: ${doomed.length} of ${runs.length} listed run(s) to prune.`,
    )
    if (doomed.length === 0) {
      // Nothing left to prune — clear any refused snapshot from the prior
      // round (those runs are gone now, however they went).
      result.failed = 0
      break
    }
    if (cfg.dryRun) {
      result.planned = doomed.length
      break
    }
    if (pass === MAX_PASSES) {
      logger.fail(
        `[${repo}] Still ${doomed.length} run(s) doomed after ${MAX_PASSES} rounds. Wanted convergence; re-run to finish the backlog.`,
      )
      result.ok = false
      return result
    }
    let passDeleted = 0
    let passRefused = 0
    const throttle = createBackoff(INITIAL_BACKOFF_MS, {
      maxMs: MAX_BACKOFF_MS,
    })
    for (let i = 0, { length } = doomed; i < length; i += 1) {
      const outcome = await deleteRun(repo, doomed[i]!)
      if (outcome === 'deleted') {
        passDeleted += 1
        throttle.reset()
        if (passDeleted % 25 === 0) {
          logger.log(`[${repo}]   deleted ${passDeleted}/${doomed.length}`)
        }
        await sleep(PACE_MS)
      } else if (outcome === 'throttled') {
        logger.warn(
          `[${repo}]   throttled at ${passDeleted}; backing off ${Math.round(throttle.currentMs() / 1000)}s`,
        )
        await throttle.wait()
        i -= 1
      } else {
        passRefused += 1
      }
    }
    result.deleted += passDeleted
    // The refused count is the LAST round's snapshot, not a running sum — a
    // run refused in round N is re-listed and retried in round N+1, and only
    // what still refuses at exit is genuinely left behind.
    result.failed = passRefused
    if (passDeleted === 0 && passRefused > 0) {
      // Every remaining doomed run refused deletion (the in-progress-run
      // shape). Wait out the grace delay so those runs can finish, then
      // retry; the delay doubles each consecutive dry round, and the worker
      // gives up only after REFUSED_RETRIES of them.
      dryRounds += 1
      if (dryRounds >= REFUSED_RETRIES) {
        logger.warn(
          `[${repo}]   ${passRefused} run(s) still refused after ${REFUSED_RETRIES} retry rounds; the weekly cadence sweeps them once they finish.`,
        )
        break
      }
      logger.log(
        `[${repo}]   ${passRefused} run(s) refused (likely in-progress); retrying in ${Math.round(grace.currentMs() / 60_000)}m (${dryRounds}/${REFUSED_RETRIES})`,
      )
      await grace.wait()
    } else {
      dryRounds = 0
      grace.reset()
    }
  }
  logger.log(
    `[${repo}] done: ${result.deleted} deleted, ${result.failed} refused.`,
  )
  return result
}

function printHelp(): void {
  logger.log('Usage: node scripts/fleet/prune-workflow-runs.mts [options]')
  logger.log('')
  logger.log(
    '  --all           prune every fleet roster repo (needs fleet-repos.json)',
  )
  logger.log('  --repo o/name   prune one repo (default: the current clone)')
  logger.log(
    `  --keep N        keep the newest N runs per present workflow (default ${KEEP_DEFAULT})`,
  )
  logger.log('  --days N        also delete runs older than N days')
  logger.log(
    '  --purge GLOB    purge every run of matching workflows (repeatable);',
  )
  logger.log(`                  built-in: ${PURGE_PATTERNS_DEFAULT.join(', ')}`)
  logger.log('  --dry-run       report what would be deleted without deleting')
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
      days: { type: 'string' },
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      keep: { type: 'string' },
      purge: { multiple: true, type: 'string' },
      repo: { type: 'string' },
    },
    strict: false,
  })
  if (values['help']) {
    printHelp()
    return
  }
  const dryRun = !!values['dry-run']
  const rawDays =
    typeof values['days'] === 'string' ? values['days'] : undefined
  const rawKeep =
    typeof values['keep'] === 'string' ? values['keep'] : undefined
  let keep: number | undefined
  if (rawKeep !== undefined) {
    keep = resolveKeepCount(rawKeep)
    if (keep === undefined) {
      logger.fail(
        `Invalid --keep value "${rawKeep}". Wanted a non-negative integer; fix the flag and re-run.`,
      )
      process.exitCode = 1
      return
    }
  } else if (rawDays === undefined) {
    keep = KEEP_DEFAULT
  }
  const cutoff =
    rawDays !== undefined
      ? computeCutoff(resolveRetentionDays(rawDays), Date.now())
      : undefined
  const policy: RetentionPolicy = { cutoff, keep }

  const rawPurge = values['purge']
  const extraPurge = Array.isArray(rawPurge)
    ? rawPurge.filter((p): p is string => typeof p === 'string')
    : []
  const purgeMatch = buildPurgeMatcher([
    ...PURGE_PATTERNS_DEFAULT,
    ...extraPurge,
  ])

  const repos = await resolveTargetRepos({
    all: !!values['all'],
    repo: typeof values['repo'] === 'string' ? values['repo'] : undefined,
  })
  if (!repos) {
    process.exitCode = 1
    return
  }

  const retention = [
    keep !== undefined ? `newest ${keep}` : '',
    rawDays !== undefined ? `<=${resolveRetentionDays(rawDays)}d` : '',
  ]
    .filter(Boolean)
    .join(' + ')
  logger.log(
    `Pruning ${repos.length} repo(s): keep ${retention} for present workflows; purge purged/absent ones${dryRun ? ' [dry-run]' : ''}.`,
  )

  const failedRepos: string[] = []
  let totalDeleted = 0
  let totalFailed = 0
  let totalPlanned = 0
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
            const result = await pruneRepo(repo, {
              dryRun,
              policy,
              purgeMatch,
            })
            totalDeleted += result.deleted
            totalFailed += result.failed
            totalPlanned += result.planned
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
      `Dry-run: ${totalPlanned} listed run(s) would be deleted across ${repos.length} repo(s); re-run without --dry-run to delete.`,
    )
  } else {
    logger.success(
      `Pruned ${totalDeleted} workflow run(s) across ${repos.length} repo(s)${totalFailed ? `; ${totalFailed} refused (likely in-progress)` : ''}.`,
    )
  }
  if (failedRepos.length > 0) {
    logger.fail(
      `Pruning incomplete for ${joinAnd(failedRepos.toSorted())}. Re-run for those repos.`,
    )
    process.exitCode = 1
  }
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
