/*
 * @file The `stashes` subcommand of `../backup-branches.mts`: archive every
 *   `git stash` entry to a permanent ref, classify each one, and drop only the
 *   ones proven superseded. The branch lane (`prune.mts`) scrubs the ref
 *   namespace; this scrubs the stash list, which grows the same way and is even
 *   less visible — `git stash` is shared by every session in a checkout, so no
 *   single session owns the backlog.
 *
 *   Three stages, in order, and each gates the next:
 *
 *   1. ARCHIVE — `git update-ref refs/stash-archive/<stamp>-<sha12>` per stash.
 *      A ref is a GC root, so the commit survives `git gc` AND survives leaving
 *      `git stash list`; the stash reflog is not a root and gives neither.
 *      Idempotent: a stash whose commit any archive ref already points at is
 *      recorded as already archived and nothing is written.
 *   2. CLASSIFY — the three probes in `stash-git.mts` feed `stash-policy.mts`,
 *      which decides superseded-or-kept and records the reason. Every probe
 *      runs, so a probe that FAILED can never pass for one that found nothing.
 *   3. PRUNE — `git stash drop` for the superseded ones ONLY, and only where the
 *      archive ref exists. Anything unclassified is kept and reported.
 *
 *   Dry run is the DEFAULT: with no flag this reads, classifies, and prints, and
 *   writes nothing at all. `--fix` is what mutates, the same flag the
 *   `normalize` lane uses for the same purpose. Dropping a stash cannot be undone
 *   from the stash list, which is exactly why the archive ref goes first.
 *
 *   Usage: node scripts/fleet/backup-branches.mts stashes
 *     [--all | --repo owner/name] [--fix] [--dry-run]
 *
 *   Auth: none. Every command is local to the checkout.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { formatStashArchiveRef } from './naming.mts'
import { resolveTargetDirs } from './prune.mts'
import { reportStashOutcome } from './report.mts'
import {
  gatherStashEvidence,
  readStashArchiveRefs,
  readStashList,
  stashGitExecFor,
} from './stash-git.mts'
import type { StashEntry, StashGitExec } from './stash-git.mts'
import { classifyStashEvidence } from './stash-policy.mts'
import type { StashVerdict } from './stash-policy.mts'

const logger = getDefaultLogger()

export type StashArchiveState = 'created' | 'existing' | 'failed' | 'pending'

export interface StashRow {
  readonly verdict: StashVerdict
  // The archive ref that holds this stash commit, or would under --fix.
  readonly archiveRef: string
  readonly archiveState: StashArchiveState
  // True when this run dropped the stash, or would have under --fix.
  readonly dropped: boolean
}

export interface StashOutcome {
  readonly repoDir: string
  readonly rows: readonly StashRow[]
  readonly dryRun: boolean
}

export interface StashSweepOptions {
  readonly fix?: boolean | undefined
}

// Required, so it is a `config` rather than an `options` bag.
export interface StashArchiveConfig {
  readonly fix: boolean
}

export interface StashArchiveRecord {
  readonly archiveRef: string
  readonly archiveState: StashArchiveState
}

/**
 * Archive one stash commit, returning the ref and what happened to it.
 *
 * Never overwrites: a commit an archive ref already points at is `existing` and
 * no write is attempted. A write that fails is `failed`, which blocks the drop.
 */
export async function archiveStash(
  entry: StashEntry,
  known: ReadonlyMap<string, string>,
  config: StashArchiveConfig,
  exec: StashGitExec,
): Promise<StashArchiveRecord> {
  const existing = known.get(entry.sha)
  if (existing !== undefined) {
    return { archiveRef: existing, archiveState: 'existing' }
  }
  const archiveRef = formatStashArchiveRef(entry.isoDate, entry.sha)
  if (!config.fix) {
    return { archiveRef, archiveState: 'pending' }
  }
  const written = await exec(['update-ref', archiveRef, entry.sha])
  if (written.code !== 0) {
    logger.warn(
      `  could not write ${archiveRef} for stash@{${String(entry.index)}} ` +
        `(exit ${String(written.code)}: ` +
        `${written.stderr.trim() || 'no stderr'}); the stash will be KEPT`,
    )
    return { archiveRef, archiveState: 'failed' }
  }
  return { archiveRef, archiveState: 'created' }
}

export interface ArchivedStash {
  readonly archiveRef: string
  readonly archiveState: StashArchiveState
  readonly entry: StashEntry
  readonly verdict: StashVerdict
}

/**
 * Archive and classify every stash, in list order. Returns one record per
 * stash, with no stash dropped yet: every archive ref exists before any drop
 * starts.
 */
export async function archiveAndClassify(
  repoDir: string,
  entries: readonly StashEntry[],
  config: StashArchiveConfig,
  exec: StashGitExec,
): Promise<ArchivedStash[]> {
  const known = await readStashArchiveRefs(repoDir, exec)
  const out: ArchivedStash[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    // oxlint-disable-next-line no-await-in-loop -- serial by design: one git process at a time, and each stash must be archived before its verdict is recorded
    const { archiveRef, archiveState } = await archiveStash(
      entry,
      known,
      config,
      exec,
    )
    // oxlint-disable-next-line no-await-in-loop -- see above
    const evidence = await gatherStashEvidence(repoDir, entry, exec)
    out.push({
      archiveRef,
      archiveState,
      entry,
      verdict: classifyStashEvidence(evidence),
    })
  }
  return out
}

/**
 * Drop the superseded stashes, returning the indices actually dropped.
 *
 * DESCENDING index order, because `git stash drop` renumbers every entry behind
 * the one it removes — ascending order would silently drop the wrong stash from
 * the second one on. Each drop re-resolves `stash@{n}` first and refuses when
 * the SHA no longer matches: the stash list is shared with every other session
 * in the checkout, and one of them can push or drop mid-sweep.
 */
export async function dropSupersededStashes(
  archived: readonly ArchivedStash[],
  exec: StashGitExec,
): Promise<Set<number>> {
  const dropped = new Set<number>()
  for (let i = archived.length - 1; i >= 0; i -= 1) {
    const record = archived[i]!
    if (!record.verdict.superseded) {
      continue
    }
    // The archive ref MUST exist first. Without it, the stash is the only place
    // this work lives.
    if (record.archiveState === 'failed') {
      logger.warn(
        `  refusing to drop stash@{${String(record.entry.index)}}: its ` +
          `archive ref ${record.archiveRef} could not be written`,
      )
      continue
    }
    const ref = `stash@{${String(record.entry.index)}}`
    // oxlint-disable-next-line no-await-in-loop -- serial by design: every drop renumbers the list, so the next iteration must see the result of this one
    const resolved = await exec(['rev-parse', ref])
    if (resolved.stdout.trim() !== record.entry.sha) {
      logger.warn(
        `  refusing to drop ${ref}: it now resolves to ` +
          `${resolved.stdout.trim() || '<nothing>'}, not ` +
          `${record.entry.sha}. Another session changed the stash list.`,
      )
      continue
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    const drop = await exec(['stash', 'drop', ref])
    if (drop.code !== 0) {
      logger.warn(
        `  failed to drop ${ref} (exit ${String(drop.code)}: ` +
          `${drop.stderr.trim() || 'no stderr'}); its archive ref ` +
          `${record.archiveRef} still holds the content`,
      )
      continue
    }
    dropped.add(record.entry.index)
  }
  return dropped
}

/**
 * Sweep one repo's stash list: archive, classify, then drop what is proven
 * superseded. A dry run stops after classifying and reports what it WOULD drop.
 */
export async function sweepStashes(
  repoDir: string,
  options?: StashSweepOptions | undefined,
  exec: StashGitExec = stashGitExecFor(repoDir),
): Promise<StashOutcome> {
  const opts = { __proto__: null, ...options } as StashSweepOptions
  const dryRun = opts.fix !== true
  const entries = await readStashList(repoDir, exec)
  const archived = await archiveAndClassify(
    repoDir,
    entries,
    { fix: !dryRun },
    exec,
  )
  const dropped = dryRun
    ? new Set(
        archived.filter(r => r.verdict.superseded).map(r => r.entry.index),
      )
    : await dropSupersededStashes(archived, exec)
  const rows: StashRow[] = []
  for (let i = 0, { length } = archived; i < length; i += 1) {
    const record = archived[i]!
    rows.push({
      archiveRef: record.archiveRef,
      archiveState: record.archiveState,
      dropped: dropped.has(record.entry.index),
      verdict: record.verdict,
    })
  }
  return { dryRun, repoDir, rows }
}

/**
 * Resolve `--fix` against `--dry-run`.
 *
 * `--dry-run` is the DEFAULT and `--fix` is the one flag that mutates. Both
 * spellings already carry those meanings elsewhere in `backup-branches.mts`, so
 * asking for the default explicitly is honored rather than rejected — and
 * asking for both resolves to the dry run, the direction that cannot lose
 * work.
 */
export function resolveStashFix(values: {
  readonly fix?: boolean | undefined
  readonly dryRun?: boolean | undefined
}): boolean {
  return values.fix === true && values.dryRun !== true
}

/**
 * The flags this lane accepts. Also the allowlist {@link unknownStashFlags}
 * checks argv against.
 */
export const STASH_FLAGS: ReadonlySet<string> = new Set([
  'all',
  'dry-run',
  'fix',
  'repo',
])

/**
 * Rewrite a parsed flag key as the kebab-case spelling an operator types.
 *
 * `parseArgs` stores BOTH spellings of every flag it parses — `--dry-run` lands
 * as `dry-run` and as `dryRun`. Comparing raw keys against the allowlist would
 * therefore report the alias of a perfectly good flag as unknown.
 */
export function toKebabFlag(name: string): string {
  let out = ''
  for (const char of name) {
    const lower = char.toLowerCase()
    out += char === lower ? char : `-${lower}`
  }
  return out
}

/**
 * The flag names in `values` that this lane does not define, kebab-cased and
 * deduped so one mistyped flag is reported once.
 *
 * `parseArgs` collects an unrecognized `--flag` as a value rather than
 * rejecting it, even under `strict`. For a lane that DROPS stashes that is a
 * live footgun: `--fix --dry-runn` would land the typo in an ignored key and
 * mutate, while the operator read their own command as a preview. Naming the
 * unknown flag and refusing to run is the only safe reading of an argv nobody
 * fully understands.
 */
export function unknownStashFlags(
  values: Readonly<Record<string, unknown>>,
): string[] {
  const unknown = new Set<string>()
  const keys = Object.keys(values)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const kebab = toKebabFlag(keys[i]!)
    if (!STASH_FLAGS.has(kebab)) {
      unknown.add(kebab)
    }
  }
  return [...unknown].toSorted()
}

/**
 * Run the `stashes` subcommand over `argv` — the arguments AFTER the subcommand
 * word, so the router owns the word and this owns the flags.
 */
export async function runStashes(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      all: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      fix: { type: 'boolean' },
      repo: { type: 'string' },
    },
    strict: true,
  })
  const unknown = unknownStashFlags(values)
  if (unknown.length > 0) {
    throw new Error(
      `Unknown flag(s) for the stash lane: ` +
        `${unknown.map(f => `--${f}`).join(', ')}. Where: ` +
        `scripts/fleet/backup-branches.mts stashes. Saw: ` +
        `${unknown.map(f => `--${f}`).join(', ')}, wanted some of ` +
        `${[...STASH_FLAGS].map(f => `--${f}`).join(' | ')}. Fix: correct the ` +
        `spelling and re-run; nothing was read, archived, or dropped.`,
    )
  }
  const fix = resolveStashFix({
    dryRun: values['dry-run'] === true,
    fix: values['fix'] === true,
  })
  if (values['fix'] === true && values['dry-run'] === true) {
    logger.warn(
      '--dry-run and --fix were both given; running the dry run and mutating ' +
        'nothing.',
    )
  }
  const repoFlag = values['repo']
  const targets =
    typeof repoFlag === 'string'
      ? [path.join(path.dirname(REPO_ROOT), repoFlag.split('/').pop() ?? '')]
      : resolveTargetDirs(REPO_ROOT, { all: values['all'] === true })
  let keptTotal = 0
  for (const dir of targets) {
    if (!existsSync(dir)) {
      continue
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- serial across repos: each sweep mutates a stash list and reports before the next starts
      const outcome = await sweepStashes(dir, { fix })
      reportStashOutcome(outcome)
      for (let i = 0, { length } = outcome.rows; i < length; i += 1) {
        if (!outcome.rows[i]!.verdict.superseded) {
          keptTotal += 1
        }
      }
    } catch (e) {
      logger.error(`${dir}: ${errorMessage(e)}`)
      process.exitCode = 1
    }
  }
  if (keptTotal > 0) {
    logger.warn(
      `\n${String(keptTotal)} stash(es) kept — each holds content this run ` +
        `could not prove superseded. Review before dropping by hand.`,
    )
  }
}
