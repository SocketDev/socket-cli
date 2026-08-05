/*
 * @file The `prune` subcommand of `../backup-branches.mts`: retire spent backup
 *   branches, the rewrite safety nets nothing else cleans up. `clean.mts`
 *   scrubs build output (`target/`, `dist/`); this scrubs the ref namespace,
 *   which grows the same way and is just as invisible until someone counts.
 *
 *   A ref is deleted only when BOTH gates agree:
 *
 *   1. RETENTION (`policy.mts`) — outside the newest `--keep N` AND older than
 *      `--days N`. Newest-N covers the fresh net an operator may still want;
 *      the age window stops a rewrite-heavy repo keeping a wall of same-day
 *      nets.
 *   2. SAFETY (`unique-content.mts`) — the backup holds no file the default
 *      branch is missing. This is a VETO: a ref carrying unique content is
 *      reported loudly and never deleted, whatever its age, because a rewrite
 *      that lost work leaves the backup as the only copy.
 *
 *   Local `backup/<slug>` heads are skipped by default and swept with
 *   `--local`; they are cheap to keep and are often a live worktree's parked
 *   tip. Remote refs are the ones that pile up.
 *
 *   Deleting a remote ref cannot be undone from a clone, so `--dry-run` prints
 *   the full verdict table — prunable, kept-and-why, vetoed-and-why — and the
 *   default `--keep`/`--days` are deliberately generous.
 *
 *   Usage: node scripts/fleet/backup-branches.mts prune
 *     [--all | --repo owner/name] [--keep N] [--days N] [--local] [--dry-run]
 *     [--allow-pre-root]
 *
 *   `--allow-pre-root` clears the squash-artifact veto class after a human has
 *   reviewed it: in a `squash-history` repo every old ref trips the safety gate
 *   because the squash erased the removal commits, so without an override the
 *   scrubber can never prune the refs it most wants to. It does NOT clear a
 *   veto on a ref inside the current history — that one is a real finding.
 *   Auth: `gh`/git push access for a remote delete; none for --dry-run.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  fleetReposPath,
  parseFleetRepos,
} from '../check/member-ci-fires-on-push.mts'
import { REPO_ROOT } from '../paths.mts'
import { runCapture } from '../publish-infra/shared.mts'
import { isBackupBranch } from './naming.mts'
import { applyRetention } from './policy.mts'
import type { BackupRef, RetentionVerdict } from './policy.mts'
import { reportOutcome } from './report.mts'
import {
  parseUniqueContentPaths,
  precedesHistoryRoot,
  uniqueContentDiffArgs,
} from './unique-content.mts'

const logger = getDefaultLogger()

/**
 * A git runner, injected so every function below is testable without a fixture
 * repo or a network remote. Same shape as `BackupBranchGitExec` in
 * `naming.mts`, which the release scan already uses — one seam convention for
 * git-touching fleet code, not two.
 */
export type GitExec = (
  args: string[],
) => Promise<{ code: number; stdout: string }>

/**
 * The production exec: `runCapture` bound to one repo.
 */
export function gitExecFor(repoDir: string): GitExec {
  return (args: string[]) => runCapture('git', args, repoDir)
}

// Remote refs are deleted one at a time. A batched
// `git push --delete a b c` fails the whole batch on one bad ref, so serial
// keeps a single failure from stranding the rest.
const REMOTE = 'origin'

export interface PruneOptions {
  readonly keep?: number | undefined
  readonly days?: number | undefined
  readonly dryRun?: boolean | undefined
  readonly local?: boolean | undefined
  // Clear the PRE-ROOT veto class only. See allowPreRoot in the CLI notes.
  readonly allowPreRoot?: boolean | undefined
}

export interface VetoedRef {
  readonly name: string
  readonly onlyOnBackup: readonly string[]
  // True when the ref is older than the default branch's root commit, so the
  // diff cannot tell removed-on-purpose from lost. See precedesHistoryRoot.
  readonly preRoot: boolean
}

export interface PruneOutcome {
  readonly repoDir: string
  readonly deleted: readonly string[]
  readonly kept: readonly RetentionVerdict[]
  // Refs the retention policy would have pruned, held back by the safety gate.
  readonly vetoed: readonly VetoedRef[]
}

/**
 * Resolve the repo's default branch. Never hard-code `main`: a fleet member can
 * be on `master`, and a wrong base would compare the backup against nothing and
 * veto every ref.
 */
export async function resolveDefaultBranch(
  repoDir: string,
  exec: GitExec = gitExecFor(repoDir),
): Promise<string> {
  const symbolic = await exec([
    'symbolic-ref',
    '--short',
    `refs/remotes/${REMOTE}/HEAD`,
  ])
  if (symbolic.code === 0) {
    const short = symbolic.stdout.trim().replace(`${REMOTE}/`, '')
    if (short !== '') {
      return short
    }
  }
  for (const candidate of ['main', 'master']) {
    // oxlint-disable-next-line no-await-in-loop -- probing two candidates in order; the second only matters when the first is absent
    const verify = await exec([
      'rev-parse',
      '--verify',
      `refs/remotes/${REMOTE}/${candidate}`,
    ])
    if (verify.code === 0) {
      return candidate
    }
  }
  throw new Error(
    `cannot resolve the default branch in ${repoDir}: no ${REMOTE}/HEAD and ` +
      `neither ${REMOTE}/main nor ${REMOTE}/master exists. Fix: run ` +
      `\`git remote set-head ${REMOTE} --auto\` in that clone.`,
  )
}

/**
 * Refresh remote-tracking refs against the real remote, pruning ones whose
 * branch is gone.
 *
 * This is load-bearing, not hygiene. `refs/remotes/origin/*` is a LOCAL cache
 * that only changes when something fetches; a clone that has not pruned in
 * weeks still lists branches deleted long ago. Reading it directly makes the
 * scrubber report phantom refs, "delete" them, and produce a
 * `remote ref does not exist` failure per ref — while its own counts overstate
 * the backlog by however many are stale. A wheelhouse clone showed 27 tracking
 * refs against 5 that actually existed.
 *
 * Runs even under --dry-run: the dry run's whole job is to preview what a real
 * run would do, so it needs the same view. The fetch mutates only local
 * tracking refs and never the remote or the working tree.
 */
export async function syncRemoteRefs(
  repoDir: string,
  exec: GitExec = gitExecFor(repoDir),
): Promise<void> {
  await exec(['fetch', '--prune', '--quiet', REMOTE])
}

export interface DiscoverOptions {
  readonly local?: boolean | undefined
}

/**
 * Discover backup refs. Remote refs always; local `backup/<slug>` heads only
 * when `local` is set. Names are matched against the anchored patterns so an
 * ordinary branch is never a candidate.
 */
export async function discoverBackupRefs(
  repoDir: string,
  options?: DiscoverOptions | undefined,
  exec: GitExec = gitExecFor(repoDir),
): Promise<BackupRef[]> {
  const opts = { __proto__: null, ...options } as DiscoverOptions
  // Two globs per tier: `backup*` alone does not match a slashed
  // `backup/<slug>`, because for-each-ref patterns match whole path segments.
  const globs = [
    `refs/remotes/${REMOTE}/backup*`,
    `refs/remotes/${REMOTE}/backup/*`,
  ]
  if (opts.local === true) {
    globs.push('refs/heads/backup*', 'refs/heads/backup/*')
  }
  const listed = await exec([
    'for-each-ref',
    '--format=%(refname)%09%(committerdate:unix)',
    ...globs,
  ])
  if (listed.code !== 0) {
    throw new Error(`git for-each-ref failed in ${repoDir}`)
  }
  const refs: BackupRef[] = []
  const listedLines = listed.stdout.split('\n')
  for (let i = 0, { length } = listedLines; i < length; i += 1) {
    const line = listedLines[i]!
    if (line.trim() === '') {
      continue
    }
    const [refname, unix] = line.split('\t')
    if (!refname || !unix) {
      continue
    }
    const name = refname
      .replace(`refs/remotes/${REMOTE}/`, '')
      .replace('refs/heads/', '')
    if (!isBackupBranch(name)) {
      continue
    }
    refs.push({ committedAtMs: Number(unix) * 1000, name })
  }
  return refs
}

/**
 * Paths present on `branch` and absent from the default branch — empty means
 * the ref is safe to delete.
 */
export async function findUniqueContent(
  repoDir: string,
  branch: string,
  defaultBranch: string,
  exec: GitExec = gitExecFor(repoDir),
): Promise<string[]> {
  const diff = await exec(
    uniqueContentDiffArgs(`${REMOTE}/${branch}`, `${REMOTE}/${defaultBranch}`),
  )
  if (diff.code !== 0) {
    // The gate fails CLOSED: a ref whose safety cannot be established is
    // reported as unsafe rather than quietly deleted.
    return [`<diff failed for ${branch}; treating as unsafe>`]
  }
  return parseUniqueContentPaths(diff.stdout)
}

/**
 * Commit time of the default branch's ROOT commit, in epoch ms.
 *
 * `--max-parents=0` selects the parentless commit(s); a squash-history repo has
 * exactly one and it is young. Returns 0 when the root cannot be read, which
 * makes precedesHistoryRoot false for every ref — the report then falls back to
 * the plain lost-work wording rather than silently claiming a squash.
 */
export async function resolveHistoryRootMs(
  repoDir: string,
  defaultBranch: string,
  exec: GitExec = gitExecFor(repoDir),
): Promise<number> {
  const root = await exec([
    'log',
    '--max-parents=0',
    '--format=%ct',
    `${REMOTE}/${defaultBranch}`,
  ])
  if (root.code !== 0) {
    return 0
  }
  const lines = root.stdout.trim().split('\n')
  // Multiple roots (a grafted / unrelated-histories merge) — the OLDEST is the
  // real boundary, since anything before it predates every line of history.
  let oldest = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const seconds = Number(lines[i]!.trim())
    if (Number.isFinite(seconds) && seconds > 0) {
      oldest = oldest === 0 ? seconds : Math.min(oldest, seconds)
    }
  }
  return oldest * 1000
}

// `nowMs` is positional, not an option: the caller MUST supply the clock. It is
// injected rather than read inside the policy so the retention rules stay
// deterministic under test.
export async function pruneRepo(
  repoDir: string,
  nowMs: number,
  options?: PruneOptions | undefined,
  exec: GitExec = gitExecFor(repoDir),
): Promise<PruneOutcome> {
  const opts = { __proto__: null, ...options } as PruneOptions
  // Before ANY read of refs/remotes/*, make that cache match the remote.
  await syncRemoteRefs(repoDir, exec)
  const defaultBranch = await resolveDefaultBranch(repoDir, exec)
  const historyRootMs = await resolveHistoryRootMs(repoDir, defaultBranch, exec)
  const refs = await discoverBackupRefs(repoDir, { local: opts.local }, exec)
  const verdicts = applyRetention(refs, {
    days: opts.days,
    keep: opts.keep,
    nowMs,
  })
  const deleted: string[] = []
  const kept: RetentionVerdict[] = []
  const vetoed: VetoedRef[] = []
  for (const verdict of verdicts) {
    if (!verdict.prunable) {
      kept.push(verdict)
      continue
    }
    const { name } = verdict.ref
    // oxlint-disable-next-line no-await-in-loop -- serial by design: each delete is a remote mutation whose failure must not strand the rest
    const onlyOnBackup = await findUniqueContent(
      repoDir,
      name,
      defaultBranch,
      exec,
    )
    if (onlyOnBackup.length > 0) {
      const preRoot = precedesHistoryRoot(
        verdict.ref.committedAtMs,
        historyRootMs,
      )
      // --allow-pre-root clears ONLY the squash-artifact class: a ref older
      // than the history root, where the diff cannot separate a deliberate
      // removal from a lost one. A ref INSIDE the current history that still
      // carries unique files is a real finding and stays held regardless — the
      // flag is a reviewed-and-cleared signal for one known-ambiguous case, not
      // a blanket --force.
      if (!(preRoot && opts.allowPreRoot === true)) {
        vetoed.push({ name, onlyOnBackup, preRoot })
        continue
      }
    }
    if (opts.dryRun === true) {
      deleted.push(name)
      continue
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    const push = await exec(['push', REMOTE, '--delete', name])
    if (push.code !== 0) {
      logger.warn(`  failed to delete ${name} (exit ${String(push.code)})`)
      continue
    }
    deleted.push(name)
  }
  return { deleted, kept, repoDir, vetoed }
}

export interface TargetOptions {
  readonly all?: boolean | undefined
}

export function resolveTargetDirs(
  repoRoot: string,
  options?: TargetOptions | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as TargetOptions
  if (opts.all !== true) {
    return [repoRoot]
  }
  const rosterPath = fleetReposPath(repoRoot)
  if (!existsSync(rosterPath)) {
    throw new Error(
      `--all needs the cascaded fleet roster. Where: ${rosterPath}. ` +
        `Saw: missing. Fix: cascade this repo, or drop --all.`,
    )
  }
  const repos = parseFleetRepos(readFileSync(rosterPath, 'utf8'))
  const siblings = path.dirname(repoRoot)
  const dirs: string[] = []
  for (const repo of repos) {
    dirs.push(path.join(siblings, repo.name))
  }
  return dirs
}

/**
 * Run the `prune` subcommand over `argv` — the arguments AFTER the subcommand
 * word, so the router owns the word and this owns the flags.
 */
export async function runPrune(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      all: { type: 'boolean' },
      days: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'allow-pre-root': { type: 'boolean' },
      keep: { type: 'string' },
      local: { type: 'boolean' },
      repo: { type: 'string' },
    },
    strict: true,
  })
  const dryRun = values['dry-run'] === true
  const options: PruneOptions = {
    allowPreRoot: values['allow-pre-root'] === true,
    days: values['days'] === undefined ? undefined : Number(values['days']),
    dryRun,
    keep: values['keep'] === undefined ? undefined : Number(values['keep']),
    local: values['local'] === true,
  }
  // One clock for the whole sweep, so every repo is judged against the same
  // instant no matter how long the loop runs.
  const nowMs = Date.now()
  const repoFlag = values['repo']
  const targets =
    typeof repoFlag === 'string'
      ? [path.join(path.dirname(REPO_ROOT), repoFlag.split('/').pop() ?? '')]
      : resolveTargetDirs(REPO_ROOT, { all: values['all'] === true })
  let vetoTotal = 0
  let preRootTotal = 0
  for (const dir of targets) {
    if (!existsSync(dir)) {
      continue
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- serial across repos: each prune mutates a remote and reports before the next starts
      const outcome = await pruneRepo(dir, nowMs, options)
      reportOutcome(outcome, { dryRun })
      vetoTotal += outcome.vetoed.length
      for (let i = 0, { length } = outcome.vetoed; i < length; i += 1) {
        if (outcome.vetoed[i]!.preRoot) {
          preRootTotal += 1
        }
      }
    } catch (e) {
      logger.error(`${dir}: ${errorMessage(e)}`)
      process.exitCode = 1
    }
  }
  if (vetoTotal > 0) {
    logger.warn(
      `\n${String(vetoTotal)} backup branch(es) held back — each carries a ` +
        `file its default branch lacks. Review before deleting by hand.` +
        (preRootTotal > 0
          ? ` ${String(preRootTotal)} of them predate the current history ` +
            `root, where that difference is expected rather than a finding.`
          : ''),
    )
  }
}
