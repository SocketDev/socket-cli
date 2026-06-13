// Fleet-wide conservative worktree tidy.
//
// Sweeps every repo in the fleet roster and removes ONLY the worktrees that are
// provably spent: working tree clean AND (branch gone from the remote OR branch
// fully merged into origin/<base>). A dirty worktree, or one whose branch still
// carries unpushed commits, is NEVER touched — it may be live work from a
// parallel Claude session. This is the low-friction "care and feeding" sweep:
// safe to run unattended (e.g. on a /loop), no prompting, conservative by
// construction.
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
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

// 1 path, 1 reference: the roster + its reader live in one shared owner.
import { readRoster } from '../../_shared/scripts/fleet-roster.mts'

const logger = getDefaultLogger()

const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

export { readRoster }

export type WorktreeDecision =
  | 'keep-primary'
  | 'keep-dirty'
  | 'keep-unlanded'
  | 'remove'

export interface WorktreeFacts {
  isPrimary: boolean
  dirty: boolean
  branchOnRemote: boolean
  mergedIntoBase: boolean
  aheadOfBase: boolean
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
 * nothing left to land. "Nothing to land" means EITHER fully merged into the
 * base, OR (branch gone from remote AND not ahead of the base).
 *
 * The `aheadOfBase` guard is load-bearing: a local-only branch never pushed to
 * the remote (e.g. a workflow's isolation worktree) is "branch gone from
 * remote" yet may carry unpushed commits. Removing it would lose that work — so
 * a worktree ahead of the base is always kept, regardless of remote state.
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
  if (facts.mergedIntoBase) {
    return {
      decision: 'remove',
      reason: 'branch fully merged into origin base, tree clean — spent',
    }
  }
  if (facts.aheadOfBase) {
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
    (e: unknown) => e as { stdout?: string; stderr?: string },
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

export interface ParsedWorktree {
  path: string
  branch: string
}

export function parseWorktreePorcelain(porcelain: string): ParsedWorktree[] {
  const out: ParsedWorktree[] = []
  let current: { path?: string; branch?: string } = {}
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
    if (!isPrimary) {
      const status = await git(wt.path, ['status', '--porcelain'])
      dirty = status.length > 0
      if (wt.branch !== '(detached)') {
        branchOnRemote = await gitOk(repoDir, [
          'ls-remote',
          '--exit-code',
          '--heads',
          'origin',
          wt.branch,
        ])
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
    const { decision, reason } = decideWorktree({
      isPrimary,
      dirty,
      branchOnRemote,
      mergedIntoBase,
      aheadOfBase,
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
  options: { fix: boolean; repoDir?: string | undefined },
): Promise<RepoResult> {
  // A repo on the roster lives at $PROJECTS/<repo>; an explicit repoDir (the
  // --here path) overrides that with the current checkout's git toplevel, so
  // the single-repo managing-worktrees Mode 3 can run the SAME engine on the
  // checkout it is invoked from rather than only a $PROJECTS sibling.
  const repoDir = options.repoDir ?? path.join(PROJECTS, repo)
  if (!existsSync(path.join(repoDir, '.git'))) {
    return { repo, removed: [], kept: [], missing: true }
  }
  const entries = await inspectRepo(repoDir)
  const removed: string[] = []
  const kept: WorktreeEntry[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry.decision === 'remove') {
      if (options.fix) {
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
  if (options.fix && removed.length) {
    await gitOk(repoDir, ['worktree', 'prune'])
  }
  return { repo, removed, kept, missing: false }
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const here = process.argv.includes('--here') || process.argv.includes('--cwd')
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    await main()
  })()
}
