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
 *   soft-reset to the base → commit each logical group by pathspec →
 *   cherry-pick the bump back → verify the final tree is BYTE-IDENTICAL to
 *   ORIG (hard-restores ORIG and fails loud on any mismatch). Nothing is
 *   pushed; pushing (usually with a lease force) is a separate, authorized
 *   step.
 *
 *   Base default: the previous `chore: bump version to …` commit below the
 *   current tip (the "previous bump"), else the latest vX.Y.Z tag.
 *
 *   Usage: node scripts/fleet/consolidate-commits.mts [--base <ref>] [--dry-run]
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential git plumbing; each step gates the next on exit status.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { commitMessage, groupPaths } from './land-work.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const BUMP_SUBJECT_RE = /^chore: bump version to \d+\.\d+\.\d+/

export interface GitResult {
  status: number
  stdout: string
}

function git(args: readonly string[]): GitResult {
  const r = spawnSync('git', [...args], {
    cwd: REPO_ROOT,
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

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
    strict: false,
  })
  const dryRun = !!values['dry-run']

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

  const tipSubject = gitOrDie(['log', '-1', '--format=%s', orig], 'tip subject')
  const bumpTip = BUMP_SUBJECT_RE.test(tipSubject) ? orig : undefined
  const workTip = bumpTip ? gitOrDie(['rev-parse', `${orig}~1`], 'work tip') : orig

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

  try {
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
    const diff = git(['diff', '--stat', orig, 'HEAD'])
    if (diff.status !== 0 || diff.stdout !== '') {
      throw new Error('final tree differs from the original tip')
    }
  } catch (e) {
    // Restore the original history — the invariant is "never lose anything".
    git(['cherry-pick', '--abort'])
    git(['reset', '--hard', orig])
    logger.fail(
      `[consolidate-commits] rewrite failed (${e instanceof Error ? e.message : String(e)}) — restored ${orig.slice(0, 12)}. History unchanged.`,
    )
    process.exitCode = 1
    return
  }

  logger.success(
    `[consolidate-commits] done: ${groups.length} logical commit(s)` +
      `${bumpTip ? ' + bump last' : ''}, tree byte-identical to ${orig.slice(0, 12)}. ` +
      'Push separately (a rewritten branch needs an authorized lease force-push).',
  )
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
