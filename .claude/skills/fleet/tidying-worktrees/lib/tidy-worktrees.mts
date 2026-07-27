// Fleet-wide conservative worktree tidy.
//
// Sweeps every repo in the fleet roster and removes ONLY the worktrees that are
// provably spent: working tree clean AND nothing left to land — branch gone
// from the remote, branch fully merged into origin/<base>, or every ahead
// commit content-equivalent to the base (100% landed via another path, e.g. a
// squash-merge or auto-land; proven per commit with in-memory `git
// merge-tree`, no working tree touched). A dirty worktree, or one whose branch
// still carries commits the base doesn't have, is NEVER touched — it may be
// live work from a parallel agent session. This is the low-friction "care and
// feeding" sweep: safe to run unattended (e.g. on a /loop), no prompting,
// conservative by construction.
//
// Shared logic with the single-repo `managing-worktrees` skill (Mode 3 prune):
// both apply the SAME removability predicate (decideWorktree). This engine is
// the fleet-wide iterator; managing-worktrees is the single-repo helper.
//
// Submodule nuance: `git worktree remove` refuses a worktree containing
// submodules even when the tree is clean. `--force` clears that guard. The
// --force flag is passed only after a clean-tree check, so it overcomes the
// submodule guard without discarding any work.
//
// Default is --dry-run (report only). Pass --fix to actually remove.
//
// Usage:
//   node tidy-worktrees.mts            # dry-run: report what WOULD be removed
//   node tidy-worktrees.mts --fix      # remove spent worktrees fleet-wide
//   node tidy-worktrees.mts --fix --repo socket-cli   # restrict to one repo

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { existsSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

// 1 path, 1 reference: the roster + its reader live in one shared owner.
import { readRoster } from '../../_shared/scripts/fleet-roster.mts'
import { isMainModule } from '../../../../../scripts/fleet/_shared/is-main-module.mts'

const logger = getDefaultLogger()

const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

export { readRoster }

export type WorktreeDecision =
  | 'keep-primary'
  | 'keep-dirty'
  | 'keep-probe-failed'
  | 'keep-unlanded'
  | 'remove'

export interface WorktreeFacts {
  isPrimary: boolean
  dirty: boolean
  branchOnRemote: boolean
  mergedIntoBase: boolean
  aheadOfBase: boolean
  // Every commit in origin/<base>..HEAD is content-equivalent to the
  // base — landed via another path (squash-merge, auto-land). Only
  // meaningful when aheadOfBase; see isFullyLanded.
  fullyLanded: boolean
  // A remote/base probe ERRORED (network down, origin/<base> ref
  // unresolvable) — as opposed to answering "no". A failed probe makes
  // every remote-derived fact above unknowable; a network blip must
  // never read as "branch gone + not ahead → removable".
  probeFailed: boolean
}

export interface WorktreeEntry {
  path: string
  branch: string
  decision: WorktreeDecision
  reason: string
}

/**
 * The single source of truth for "is this worktree spent?". Conservative by
 * construction: a worktree is only removable when its tree is clean AND it has
 * nothing left to land. "Nothing to land" means fully merged into the base, OR
 * the ahead commits are each content-equivalent to the base (100% landed via
 * another path — a squash-merge or auto-land), OR (branch gone from remote AND
 * not ahead of the base).
 *
 * The `aheadOfBase` guard is load-bearing: a local-only branch never pushed to
 * the remote (e.g. a workflow's isolation worktree) is "branch gone from
 * remote" yet may carry unpushed commits. Removing it would lose that work — so
 * a worktree ahead of the base is kept unless `fullyLanded` proves (per commit,
 * via merge-tree) that the base already contains what it carries.
 */
export function decideWorktree(facts: WorktreeFacts): {
  decision: WorktreeDecision
  reason: string
} {
  if (facts.isPrimary) {
    return { decision: 'keep-primary', reason: 'primary checkout' }
  }
  if (facts.dirty) {
    return {
      decision: 'keep-dirty',
      reason: 'uncommitted changes — may be live work, never auto-removed',
    }
  }
  if (facts.probeFailed) {
    return {
      decision: 'keep-probe-failed',
      reason:
        'a remote/base probe errored (offline, or origin base unresolvable) — remote facts are unknowable, kept',
    }
  }
  if (facts.mergedIntoBase) {
    return {
      decision: 'remove',
      reason: 'branch fully merged into origin base, tree clean — spent',
    }
  }
  if (facts.aheadOfBase) {
    if (facts.fullyLanded) {
      return {
        decision: 'remove',
        reason:
          'origin base already contains this branch content (100% landed) — spent',
      }
    }
    return {
      decision: 'keep-unlanded',
      reason: 'ahead of origin base with unpushed commits — would lose work',
    }
  }
  if (!facts.branchOnRemote) {
    return {
      decision: 'remove',
      reason:
        'branch gone from remote, not ahead of base, tree clean — nothing to land',
    }
  }
  return {
    decision: 'keep-unlanded',
    reason: 'branch still on remote with unlanded commits',
  }
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await spawn('git', args, { cwd, stdioString: true }).catch(
    (e: unknown) =>
      e as { stdout?: string | undefined; stderr?: string | undefined },
  )
  return String(result?.stdout ?? '').trim()
}

export async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  return await spawn('git', args, { cwd, stdioString: true }).then(
    () => true,
    () => false,
  )
}

/**
 * Resolve the remote default branch per the fleet main → master → main
 * fallback. Never hard-codes a branch.
 */
export async function resolveBase(repoDir: string): Promise<string> {
  const head = await git(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  const fromHead = head.replace(/^refs\/remotes\/origin\//, '')
  if (fromHead) {
    return fromHead
  }
  if (
    await gitOk(repoDir, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/remotes/origin/main',
    ])
  ) {
    return 'main'
  }
  if (
    await gitOk(repoDir, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/remotes/origin/master',
    ])
  ) {
    return 'master'
  }
  return 'main'
}

// Cap for the per-commit landed check: a lineage longer than this (e.g.
// a pre-squash worktree carrying the old history) is kept unchecked —
// the sweep stays fast and the failure mode is conservative.
export const MAX_LANDED_CHECK_COMMITS = 200

export interface CommitClassification {
  readonly sha: string
  readonly subject: string
  readonly verdict: 'landed' | 'unlanded' | 'superseded' | 'unreviewable'
}

/**
 * Classify each commit the branch carries beyond the base, proven per
 * commit without touching any working tree: `git merge-tree --write-tree
 * --merge-base=<sha>^ origin/<base> <sha>` three-way-merges the commit's
 * own delta onto the base in-memory.
 *
 * - Landed — clean merge whose result tree IS the base tree: the base already
 *   contains the content (a squash-merge, an auto-land, a rebase landed it).
 * - Unlanded — clean merge with a DIFFERING tree: real content the base lacks.
 * - Superseded — the delta conflicts with the base: the base evolved past it (or
 *   it is live divergent work — human review decides).
 * - Unreviewable — no parent to delta against (an orphan/squash root), an
 *   over-cap lineage tail, or an old git without `--merge-base` (< 2.40).
 *
 * The walk is bounded away from pre-squash history: commits reachable from
 * any fetched `origin/backup-*` ref (the squash skill pushes one per
 * squash) are excluded, so only the branch's OWN commits are checked even
 * across a history squash.
 */
export async function classifyCommits(
  repoDir: string,
  wtPath: string,
  base: string,
): Promise<CommitClassification[]> {
  const list = await git(wtPath, [
    'rev-list',
    '--reverse',
    'HEAD',
    '--not',
    `origin/${base}`,
    '--glob=refs/remotes/origin/backup-*',
  ])
  const shas = list ? list.split('\n').filter(Boolean) : []
  const out: CommitClassification[] = []
  if (shas.length === 0) {
    return out
  }
  const baseTree = await git(repoDir, ['rev-parse', `origin/${base}^{tree}`])
  const subjectOf = async (sha: string): Promise<string> =>
    await git(repoDir, ['log', '-1', '--format=%s', sha])
  for (let i = 0, { length } = shas; i < length; i += 1) {
    const sha = shas[i]!
    if (!baseTree || i >= MAX_LANDED_CHECK_COMMITS) {
      out.push({ sha, subject: await subjectOf(sha), verdict: 'unreviewable' })
      continue
    }
    const hasParent = await gitOk(repoDir, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${sha}^`,
    ])
    if (!hasParent) {
      out.push({ sha, subject: await subjectOf(sha), verdict: 'unreviewable' })
      continue
    }
    const merged = await spawn(
      'git',
      [
        'merge-tree',
        '--write-tree',
        `--merge-base=${sha}^`,
        `origin/${base}`,
        sha,
      ],
      { cwd: repoDir, stdioString: true },
    ).catch(() => undefined)
    const resultTree = String(merged?.stdout ?? '')
      .trim()
      .split('\n')[0]
    const verdict = !resultTree
      ? 'superseded'
      : resultTree === baseTree
        ? 'landed'
        : 'unlanded'
    out.push({ sha, subject: await subjectOf(sha), verdict })
  }
  return out
}

/**
 * True when the base already contains the content of EVERY commit the
 * branch carries — every classifyCommits verdict is 'landed'. An empty
 * classification (not ahead once backup-reachable history is excluded),
 * any unlanded/superseded content, or anything unreviewable answers
 * false — the check only ever errs toward keeping.
 */
export async function isFullyLanded(
  repoDir: string,
  wtPath: string,
  base: string,
): Promise<boolean> {
  const classified = await classifyCommits(repoDir, wtPath, base)
  return classified.length > 0 && classified.every(c => c.verdict === 'landed')
}

export interface ParsedWorktree {
  path: string
  branch: string
}

export function parseWorktreePorcelain(porcelain: string): ParsedWorktree[] {
  const out: ParsedWorktree[] = []
  let current: { path?: string | undefined; branch?: string | undefined } = {}
  const lines = porcelain.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('worktree ')) {
      if (current.path) {
        out.push({
          path: current.path,
          branch: current.branch ?? '(detached)',
        })
      }
      current = { path: line.slice('worktree '.length) }
    } else if (line.startsWith('branch ')) {
      current.branch = line
        .slice('branch '.length)
        .replace(/^refs\/heads\//, '')
    }
  }
  if (current.path) {
    out.push({ path: current.path, branch: current.branch ?? '(detached)' })
  }
  return out
}

export async function inspectRepo(repoDir: string): Promise<WorktreeEntry[]> {
  const primary = await git(repoDir, ['rev-parse', '--show-toplevel'])
  const base = await resolveBase(repoDir)
  await spawn('git', ['fetch', 'origin', base], {
    cwd: repoDir,
    stdioString: true,
  }).catch(() => undefined)
  // The squash skill pushes a backup-<ts> ref per history squash; fetching
  // them lets the landed check exclude pre-squash history, so a worktree
  // that outlived a squash is judged on its OWN commits. No backup refs →
  // the glob adds nothing and behavior is unchanged.
  await spawn(
    'git',
    ['fetch', 'origin', '+refs/heads/backup-*:refs/remotes/origin/backup-*'],
    { cwd: repoDir, stdioString: true },
  ).catch(() => undefined)
  const porcelain = await git(repoDir, ['worktree', 'list', '--porcelain'])
  const worktrees = parseWorktreePorcelain(porcelain)

  const entries: WorktreeEntry[] = []
  for (let i = 0, { length } = worktrees; i < length; i += 1) {
    const wt = worktrees[i]!
    const isPrimary = wt.path === primary
    let dirty = false
    let branchOnRemote = false
    let mergedIntoBase = false
    let aheadOfBase = false
    let probeFailed = false
    if (!isPrimary) {
      const status = await git(wt.path, ['status', '--porcelain'])
      dirty = status.length > 0
      // The base must RESOLVE for merged/ahead to mean anything — a fresh
      // or offline clone without origin/<base> would read every worktree
      // as not-ahead.
      if (
        !(await gitOk(repoDir, [
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/remotes/origin/${base}`,
        ]))
      ) {
        probeFailed = true
      }
      if (wt.branch !== '(detached)') {
        // ls-remote --exit-code answers exit 2 for "ref definitively
        // absent"; anything else non-zero is a FAILED probe (network,
        // auth), not an answer.
        const lsRemote = await spawn(
          'git',
          ['ls-remote', '--exit-code', '--heads', 'origin', wt.branch],
          { cwd: repoDir, stdioString: true },
        ).then(
          () => 0,
          (e: unknown) => (e as { code?: number | undefined })?.code ?? 128,
        )
        branchOnRemote = lsRemote === 0
        if (lsRemote !== 0 && lsRemote !== 2) {
          probeFailed = true
        }
      }
      const head = await git(wt.path, ['rev-parse', 'HEAD'])
      mergedIntoBase = head
        ? await gitOk(repoDir, [
            'merge-base',
            '--is-ancestor',
            head,
            `origin/${base}`,
          ])
        : false
      const aheadCount = await git(wt.path, [
        'rev-list',
        '--count',
        `origin/${base}..HEAD`,
      ])
      aheadOfBase = Number(aheadCount) > 0
    }
    // The merge-tree walk is the expensive fact — compute it only when
    // it can change the decision (clean, ahead, not already merged).
    const fullyLanded =
      !isPrimary && !dirty && !mergedIntoBase && aheadOfBase
        ? await isFullyLanded(repoDir, wt.path, base)
        : false
    const { decision, reason } = decideWorktree({
      isPrimary,
      dirty,
      probeFailed,
      branchOnRemote,
      mergedIntoBase,
      aheadOfBase,
      fullyLanded,
    })
    entries.push({ path: wt.path, branch: wt.branch, decision, reason })
  }
  return entries
}

export async function removeWorktree(
  repoDir: string,
  entry: WorktreeEntry,
): Promise<boolean> {
  // --force clears the submodule-worktree guard; the tree is already confirmed
  // clean by decideWorktree, so this discards nothing.
  const removed = await gitOk(repoDir, [
    'worktree',
    'remove',
    '--force',
    entry.path,
  ])
  if (removed && entry.branch !== '(detached)') {
    await gitOk(repoDir, ['branch', '-D', entry.branch])
  }
  return removed
}

export interface RepoResult {
  repo: string
  removed: string[]
  kept: WorktreeEntry[]
  missing: boolean
}

export async function tidyRepo(
  repo: string,
  config: { fix: boolean; repoDir?: string | undefined },
): Promise<RepoResult> {
  // A repo on the roster lives at $PROJECTS/<repo>; an explicit repoDir (the
  // --here path) overrides that with the current checkout's git toplevel, so
  // the single-repo managing-worktrees Mode 3 can run the SAME engine on the
  // checkout it is invoked from rather than only a $PROJECTS sibling.
  const cfg = { __proto__: null, ...config } as typeof config
  const repoDir = cfg.repoDir ?? path.join(PROJECTS, repo)
  if (!existsSync(path.join(repoDir, '.git'))) {
    return { repo, removed: [], kept: [], missing: true }
  }
  const entries = await inspectRepo(repoDir)
  const removed: string[] = []
  const kept: WorktreeEntry[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry.decision === 'remove') {
      if (cfg.fix) {
        const ok = await removeWorktree(repoDir, entry)
        if (ok) {
          removed.push(entry.path)
        } else {
          kept.push({
            ...entry,
            decision: 'keep-unlanded',
            reason: 'removal failed',
          })
        }
      } else {
        removed.push(entry.path)
      }
    } else if (entry.decision !== 'keep-primary') {
      kept.push(entry)
    }
  }
  if (cfg.fix && removed.length) {
    await gitOk(repoDir, ['worktree', 'prune'])
  }
  return { repo, removed, kept, missing: false }
}

/**
 * Print the per-commit landed/unlanded/superseded classification for every
 * non-primary worktree of a repo — the audit that used to be a hand-rolled
 * cherry-pick loop. Read-only.
 */
export async function auditRepo(repoDir: string): Promise<void> {
  const entries = await inspectRepo(repoDir)
  const base = await resolveBase(repoDir)
  const porcelain = await git(repoDir, ['worktree', 'list', '--porcelain'])
  const worktrees = parseWorktreePorcelain(porcelain)
  const primary = await git(repoDir, ['rev-parse', '--show-toplevel'])
  for (let i = 0, { length } = worktrees; i < length; i += 1) {
    const wt = worktrees[i]!
    if (wt.path === primary) {
      continue
    }
    const classified = await classifyCommits(repoDir, wt.path, base)
    const decision = entries.find(e => e.path === wt.path)
    logger.info(`── ${wt.path} [${wt.branch}] — ${decision?.reason ?? ''}`)
    if (classified.length === 0) {
      logger.substep(
        'no commits beyond the base (post-squash history excluded)',
      )
      continue
    }
    for (let j = 0, { length: n } = classified; j < n; j += 1) {
      const c = classified[j]!
      logger.substep(
        `${c.verdict.padEnd(12)} ${c.sha.slice(0, 9)} ${c.subject}`,
      )
    }
  }
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const here = process.argv.includes('--here') || process.argv.includes('--cwd')
  if (process.argv.includes('--audit')) {
    const toplevel = (
      await git(process.cwd(), ['rev-parse', '--show-toplevel'])
    ).trim()
    logger.info(`tidy-worktrees (AUDIT) — ${path.basename(toplevel)}`)
    await auditRepo(toplevel)
    return
  }
  const repoIdx = process.argv.indexOf('--repo')
  const onlyRepo = repoIdx !== -1 ? process.argv[repoIdx + 1] : undefined

  // --here: tidy ONLY the current checkout (the single-repo managing-worktrees
  // Mode 3 path), resolving its git toplevel rather than a $PROJECTS sibling.
  // This runs the same removability predicate (decideWorktree) the fleet sweep
  // uses, so the single-repo case inherits the load-bearing aheadOfBase guard.
  if (here) {
    const toplevel = (
      await git(process.cwd(), ['rev-parse', '--show-toplevel'])
    ).trim()
    const repo = path.basename(toplevel)
    const mode = fix ? 'FIX' : 'DRY-RUN'
    logger.info(`tidy-worktrees (${mode}) — current checkout ${repo}`)
    const result = await tidyRepo(repo, { fix, repoDir: toplevel })
    if (result.removed.length) {
      const verb = fix ? 'removed' : 'would remove'
      logger.info(`── ${repo} ──`)
      for (let j = 0, n = result.removed.length; j < n; j += 1) {
        logger.info(`  - ${verb} ${result.removed[j]}`)
      }
      if (fix) {
        logger.success(
          `tidy-worktrees: removed ${result.removed.length} spent worktree(s). Run \`pnpm i\` in this checkout to relink.`,
        )
      } else {
        logger.info(
          `tidy-worktrees: ${result.removed.length} spent worktree(s) would be removed. Re-run with --fix to act.`,
        )
      }
    } else {
      logger.success(
        'tidy-worktrees: nothing to tidy — every worktree is live or primary.',
      )
    }
    return
  }

  const roster = onlyRepo ? [onlyRepo] : readRoster()
  const mode = fix ? 'FIX' : 'DRY-RUN'
  logger.info(`tidy-worktrees (${mode}) — ${roster.length} repo(s)`)

  let totalRemoved = 0
  const reposWithRemovals: string[] = []
  for (let i = 0, { length } = roster; i < length; i += 1) {
    const repo = roster[i]!
    const result = await tidyRepo(repo, { fix })
    if (result.missing) {
      continue
    }
    if (result.removed.length) {
      totalRemoved += result.removed.length
      reposWithRemovals.push(repo)
      const verb = fix ? 'removed' : 'would remove'
      logger.info(`── ${repo} ──`)
      for (let j = 0, n = result.removed.length; j < n; j += 1) {
        logger.info(`  - ${verb} ${result.removed[j]}`)
      }
    }
  }

  if (totalRemoved === 0) {
    logger.success(
      'tidy-worktrees: nothing to tidy — every worktree is live or primary.',
    )
  } else if (fix) {
    logger.success(
      `tidy-worktrees: removed ${totalRemoved} spent worktree(s) across ${reposWithRemovals.length} repo(s). Run \`pnpm i\` in each repo's primary checkout to relink: ${reposWithRemovals.join(', ')}.`,
    )
  } else {
    logger.info(
      `tidy-worktrees: ${totalRemoved} spent worktree(s) across ${reposWithRemovals.length} repo(s) would be removed. Re-run with --fix to act.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  void (async () => {
    await main()
  })()
}
