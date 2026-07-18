/*
 * @file Consolidate a commit range into LOGICAL commits (never one squash).
 *
 *   "Consolidate commits" in fleet vocabulary means regrouping the work since
 *   a base ref into one commit per logical concern (the auto-lander's
 *   grouping: same `groupPaths`/`commitMessage` engine as land-work.mts),
 *   with a trailing `chore: bump version to X.Y.Z` commit preserved LAST.
 *   It never means squashing to a single commit — that is `squashing-history`.
 *
 *   Flow: verify the worktree is clean (land dirty files first via
 *   `land-work.mts --commit`) → capture ORIG → peel a bump tip if present →
 *   create a durable recovery ref → soft-reset to the base → commit each
 *   logical group by pathspec → cherry-pick the bump back → verify the
 *   final tree object is IDENTICAL to ORIG (hard-restores ORIG and fails loud
 *   on any mismatch). Nothing is pushed; the final report says whether a
 *   normal push is a fast-forward or a separately authorized lease force-push
 *   is required.
 *
 *   Base default: the previous `chore: bump version to …` commit below the
 *   current tip (the "previous bump"), else the latest vX.Y.Z tag.
 *
 *   Usage: node scripts/fleet/consolidate-commits.mts [--repo <path>]
 *     [--base <ref>] [--dry-run]
 */

import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential git plumbing; each step gates the next on exit status.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { groupPaths } from './land-work.mts'
import { commitMessage } from './land-work/message.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const BUMP_SUBJECT_RE = /^chore: bump version to \d+\.\d+\.\d+/
let gitRoot = REPO_ROOT

export interface GitResult {
  status: number
  stdout: string
}

function git(args: readonly string[]): GitResult {
  const r = spawnSync('git', [...args], {
    cwd: gitRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  return { status: r.status ?? 1, stdout: String(r.stdout ?? '').trim() }
}

function gitOrDie(args: readonly string[], what: string): string {
  const r = git(args)
  if (r.status !== 0) {
    logger.fail(`[consolidate-commits] ${what} failed: git ${args.join(' ')}`)
    process.exitCode = 1
    throw new Error(what)
  }
  return r.stdout
}

/**
 * The default base: the newest `chore: bump version to …` commit strictly
 * below `tip` (the previous release bump), else the latest version tag, else
 * undefined (caller must pass --base).
 */
export function defaultBase(tip: string): string | undefined {
  const r = git([
    'log',
    '--format=%H %s',
    '--grep=^chore: bump version to',
    `${tip}~1`,
  ])
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.split('\n')[0]
    const sha = first?.split(' ')[0]
    if (sha) {
      return sha
    }
  }
  const tag = git(['describe', '--tags', '--abbrev=0', `${tip}~1`])
  return tag.status === 0 && tag.stdout ? tag.stdout : undefined
}

/**
 * True when `base` and `originRef` have DIVERGED — neither contains the
 * other. A base above origin's tip (unpushed span on the same lineage) and a
 * base below it (normal release anchor) are both legitimate; divergence means
 * the base sits on superseded history and consolidating onto it re-embeds
 * old-lineage commits.
 */
export function isOffLineage(options: {
  baseReachableFromOrigin: boolean
  originReachableFromBase: boolean
}): boolean {
  const opts = { __proto__: null, ...options }
  return !opts.baseReachableFromOrigin && !opts.originReachableFromBase
}

export interface RewritePushLineage {
  originAvailable: boolean
  originIsAncestorOfHead: boolean
}

export type RewritePushDisposition = 'fast-forward' | 'lease-force' | 'unknown'

/**
 * Classify the push required after the local history rewrite.
 */
export function classifyRewritePush(
  options: RewritePushLineage,
): RewritePushDisposition {
  const opts = { __proto__: null, ...options } as RewritePushLineage
  if (!opts.originAvailable) {
    return 'unknown'
  }
  return opts.originIsAncestorOfHead ? 'fast-forward' : 'lease-force'
}

/**
 * A local-only ref that keeps the exact pre-rewrite tip reachable.
 */
export function recoveryRefForTip(tip: string): string {
  return `refs/fleet/recovery/consolidate/${tip}`
}

function resolveOriginDefaultRef(): string | undefined {
  const sym = git(['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (sym.status === 0 && sym.stdout) {
    return sym.stdout.replace('refs/remotes/', '')
  }
  for (const name of ['origin/main', 'origin/master']) {
    if (git(['rev-parse', '--verify', name]).status === 0) {
      return name
    }
  }
  return undefined
}

function isAncestor(ancestor: string, descendant: string): boolean {
  return git(['merge-base', '--is-ancestor', ancestor, descendant]).status === 0
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'allow-off-lineage-base': { type: 'boolean' },
      base: { type: 'string' },
      'dry-run': { type: 'boolean' },
      repo: { type: 'string' },
    },
    strict: false,
  })
  const dryRun = !!values['dry-run']
  if (typeof values['repo'] === 'string' && values['repo']) {
    gitRoot = path.resolve(values['repo'])
  }

  const dirty = gitOrDie(['status', '--porcelain'], 'status')
  if (dirty) {
    logger.fail(
      '[consolidate-commits] the worktree is dirty. Land the dirty files ' +
        'first (node scripts/fleet/land-work.mts --commit), then re-run.',
    )
    process.exitCode = 1
    return
  }

  const orig = gitOrDie(['rev-parse', 'HEAD'], 'rev-parse HEAD')
  const originalTree = gitOrDie(
    ['rev-parse', `${orig}^{tree}`],
    'resolve original tree',
  )
  const branch = git(['symbolic-ref', '--short', 'HEAD']).stdout || 'HEAD'
  const base =
    typeof values['base'] === 'string' && values['base']
      ? gitOrDie(['rev-parse', String(values['base'])], 'resolve --base')
      : defaultBase(orig)
  if (!base) {
    logger.fail(
      '[consolidate-commits] no previous bump commit or version tag found ' +
        'below HEAD — pass --base <ref>.',
    )
    process.exitCode = 1
    return
  }

  // Off-lineage base guard. After a force-push rewrite, old anchors (a
  // version tag, an npm gitHead) still point into the REPLACED history.
  // Consolidating onto such a base rebuilds the branch on that dead line, so
  // every replaced commit comes back — including ones the rewrite existed to
  // remove (hit live: socket-mcp's v0.0.20 tag resurrected an AI-attributed
  // commit the pre-push gate then rejected).
  const originRef = resolveOriginDefaultRef()
  if (originRef && !values['allow-off-lineage-base']) {
    if (
      isOffLineage({
        baseReachableFromOrigin: isAncestor(base, originRef),
        originReachableFromBase: isAncestor(originRef, base),
      })
    ) {
      logger.fail(
        `[consolidate-commits] the base commit is not part of ${originRef}'s history.\n` +
          `  What:   --base ${base.slice(0, 12)} sits on an old line of history that a force-push already replaced (stale anchors do this: a version tag or an npm gitHead minted before the rewrite).\n` +
          `  Why:    consolidating onto it would rebuild your branch on that dead line, bringing every replaced commit back — including ones the rewrite removed on purpose (the pre-push gate will reject them again).\n` +
          `  Fix:    pick the SAME release point on the live history instead — find it with\n` +
          `            git log ${originRef} --oneline | head -20\n` +
          `          (look for the matching bump/release subject) and pass that sha as --base.\n` +
          `  Escape: --allow-off-lineage-base skips this check, ONLY for consolidating a deliberately local-only lineage.`,
      )
      process.exitCode = 1
      return
    }
  }

  const tipSubject = gitOrDie(['log', '-1', '--format=%s', orig], 'tip subject')
  const bumpTip = BUMP_SUBJECT_RE.test(tipSubject) ? orig : undefined
  const workTip = bumpTip
    ? gitOrDie(['rev-parse', `${orig}~1`], 'work tip')
    : orig

  // --no-renames keeps every rename as an explicit A+D pair so the staging
  // loop below sees the deletion side.
  const changed = gitOrDie(
    ['diff', '--name-status', '--no-renames', `${base}..${workTip}`],
    'diff --name-status',
  )
  const statusByPath = new Map<string, string>()
  const lines = changed ? changed.split('\n') : []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const tab = line.indexOf('\t')
    if (tab > 0) {
      statusByPath.set(line.slice(tab + 1), line.slice(0, 1))
    }
  }
  const paths = [...statusByPath.keys()]
  if (!paths.length) {
    logger.log('[consolidate-commits] nothing between base and tip — no-op.')
    return
  }

  const groups = groupPaths(paths)
  const originalCommitCount = Number(
    gitOrDie(['rev-list', '--count', `${base}..${orig}`], 'count commits'),
  )
  logger.log(
    `[consolidate-commits] source: local ${branch} tip ${orig.slice(0, 12)} is the canonical content; ${base.slice(0, 12)} only sets the new parent lineage.`,
  )
  logger.log(
    `[consolidate-commits] ${paths.length} path(s) since ${base.slice(0, 12)} → ${groups.length} logical commit(s)` +
      `${bumpTip ? ' + the bump kept last' : ''}:`,
  )
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const g = groups[i]!
    logger.log(`  ${commitMessage(g)}  (${g.paths.length} path(s))`)
  }
  if (dryRun) {
    logger.log('[consolidate-commits] dry-run: no history rewritten.')
    return
  }

  const recoveryRef = recoveryRefForTip(orig)
  try {
    gitOrDie(
      ['update-ref', '-m', 'consolidate-commits recovery', recoveryRef, orig],
      'create recovery ref',
    )
    // Materialize the WORK tree, then point HEAD at base keeping that tree.
    gitOrDie(['reset', '--hard', workTip], 'reset to work tip')
    gitOrDie(['reset', '--soft', base], 'soft reset to base')
    // Build each commit by staging the group's paths from the WORK tree-ish
    // straight into the index (`git reset <tree> -- <paths>`): tree-based
    // index ops handle adds/edits/deletions uniformly and, unlike `add`,
    // never refuse a gitignored-but-tracked path (the .agents/ mirror).
    gitOrDie(['reset', '-q', base, '--', '.'], 'index to base')
    for (let i = 0, { length } = groups; i < length; i += 1) {
      const g = groups[i]!
      // `git reset <tree> -- <path>` silently skips a path ABSENT from the
      // tree, so deletions must stage via `rm --cached`.
      const deleted = g.paths.filter(p => statusByPath.get(p) === 'D')
      const present = g.paths.filter(p => statusByPath.get(p) !== 'D')
      if (present.length) {
        gitOrDie(
          ['reset', '-q', workTip, '--', ...present],
          `stage group ${g.scope}`,
        )
      }
      if (deleted.length) {
        gitOrDie(
          ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...deleted],
          `stage deletions for group ${g.scope}`,
        )
      }
      gitOrDie(
        ['commit', '--no-verify', '-m', commitMessage(g)],
        `commit group ${g.scope}`,
      )
    }
    const leftover = gitOrDie(
      ['diff', '--stat', 'HEAD', workTip],
      'post-group tree compare',
    )
    if (leftover) {
      throw new Error(`ungrouped content remains:\n${leftover}`)
    }
    if (bumpTip) {
      // cherry-pick has no --no-verify; it runs no pre-commit hooks anyway.
      gitOrDie(['cherry-pick', bumpTip], 'cherry-pick bump')
    }
    const finalTree = gitOrDie(
      ['rev-parse', 'HEAD^{tree}'],
      'resolve consolidated tree',
    )
    if (finalTree !== originalTree) {
      throw new Error('final tree differs from the original tip')
    }
  } catch (e) {
    // Restore the original history — the invariant is "never lose anything".
    git(['cherry-pick', '--abort'])
    git(['reset', '--hard', orig])
    git(['update-ref', '-d', recoveryRef])
    logger.fail(
      `[consolidate-commits] rewrite failed (${e instanceof Error ? e.message : String(e)}) — restored ${orig.slice(0, 12)}. History unchanged.`,
    )
    process.exitCode = 1
    return
  }

  const newTip = gitOrDie(['rev-parse', 'HEAD'], 'resolve consolidated tip')
  const pushDisposition = classifyRewritePush({
    originAvailable: !!originRef,
    originIsAncestorOfHead: originRef ? isAncestor(originRef, newTip) : false,
  })
  const originLabel = originRef ?? 'the origin default ref'
  const pushGuidance =
    pushDisposition === 'fast-forward'
      ? `${originLabel} is an ancestor of the new tip; use a normal git push.`
      : pushDisposition === 'lease-force'
        ? `${originLabel} is not an ancestor of the new tip; pushing requires a separately authorized lease force-push.`
        : 'No origin default ref is available; inspect the destination lineage before pushing.'
  const originalCommitLabel = `${originalCommitCount} original commit${originalCommitCount === 1 ? '' : 's'}`
  logger.success(
    `[consolidate-commits] done: ${groups.length} logical commit(s)` +
      `${bumpTip ? ' + bump last' : ''}, tree byte-identical to ${orig.slice(0, 12)}. ` +
      `${originalCommitLabel} replaced; recover the original history at ${recoveryRef}. ` +
      `Push separately: ${pushGuidance}`,
  )
}

if (isMainModule(import.meta.url)) {
  main()
}
