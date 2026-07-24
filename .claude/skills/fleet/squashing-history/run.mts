#!/usr/bin/env node
/*
 * Squashing-history runner — the low-level squash-to-one-commit primitive.
 *
 * Collapses a Socket fleet repo's default branch to a single
 * "chore: initial commit", verifies the tree is byte-identical to the
 * pre-squash backup, and force-pushes with a lease. The SQUASH_HISTORY=1
 * sentinel scopes the no-revert-guard `--no-verify` bypass on the amend and
 * the no-force-push-guard bypass on the push to exactly those two commands.
 * Operates in a sibling worktree; the primary checkout is never disturbed.
 *
 * Phases match the table in SKILL.md:
 *
 * 1. Pre-flight — resolve default branch, fetch, capture orig HEAD/count
 * 2. Worktree — git worktree add -b chore/squash ../<repo>-squash
 * 3. Backup — push <orig-head>:refs/heads/backup-<ts> before any destruction
 * 4. Squash — reset --soft to first commit + amend; count == 1 gate
 * 5. Integrity — diff vs orig must be empty (HARD exit on mismatch)
 * 6. Force-push — SQUASH_HISTORY=1 git push --force-with-lease origin HEAD:$BASE
 * 7. Cleanup — git worktree remove + branch -D
 * 8. Report — new SHA, backup ref, recovery one-liner
 *
 * The squash mechanics live in squashSingleCommit() so refreshing-history (the
 * higher-level dep-refresh wrapper) can reuse the same engine without copying
 * the reset/amend/count/integrity dance.
 *
 * Usage: node .claude/skills/fleet/squashing-history/run.mts /path/to/<repo>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { isError } from '@socketsecurity/lib/errors/predicates'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  COMMIT_LOG_FORMAT,
  generateChangelogSection,
  mergeUnreleased,
  parseConventionalCommits,
  repoBaseUrl,
  sectionHasEntries,
  UNRELEASED_HEADING,
} from '../../../../scripts/fleet/lib/changelog.mts'
import { slugFromRemoteUrl } from '../../../hooks/fleet/_shared/fleet-repos.mts'
import { resolveDefaultBranch } from '../_shared/scripts/git-default-branch.mts'
import { header, run, timestamp } from '../_shared/scripts/run-helpers.mts'
import { formatBackupBranch } from '../../../../scripts/fleet/lib/backup-branch.mts'
import { checkNotShallowClone, checkSquashAllowed } from './run-guards.mts'
import {
  squashLocalCanonicalMode,
  squashWorktreeMode,
} from './run-squash-modes.mts'

const logger = getDefaultLogger()

/**
 * The canonical fleet name of a checkout — its origin remote slug (so a
 * differently-named local directory still resolves to the roster identity),
 * falling back to the directory basename when there is no origin.
 */
export async function resolveFleetName(src: string): Promise<string> {
  try {
    const url = (
      await run('git', ['remote', 'get-url', 'origin'], src)
    ).stdout.trim()
    const slug = slugFromRemoteUrl(url)
    if (slug) {
      return slug
    }
  } catch {}
  return path.basename(src)
}

export { header, run, timestamp }

/**
 * Derive a canonical recovery-ref name from the commit Git will preserve.
 */
export async function backupBranchForCommit(
  cwd: string,
  sha: string,
): Promise<string> {
  const date = (await run('git', ['show', '-s', '--format=%cI', sha], cwd))
    .stdout
  return formatBackupBranch(date)
}

/**
 * Accrue user-visible CHANGELOG entries into the `## [Unreleased]` section
 * before a squash collapses the commit history those entries derive from.
 * Derives the Conventional-Commit entries since the current root, merges them
 * into CHANGELOG.md at `cwd`, and commits that file on the checked-out branch
 * (--no-verify, unsigned — the commit is squashed away moments later so only
 * its TREE survives, re-signed by the mint/squash root). Returns the
 * post-accrual HEAD sha (the current HEAD when nothing was accrued). Fail-open:
 * any problem logs and returns the current HEAD, so a changelog hiccup never
 * blocks a squash. The caller must have `cwd` checked out on the branch being
 * squashed.
 */
export async function accrueUnreleased(
  cwd: string,
  repoUrl: string | undefined,
): Promise<string> {
  const headSha = async (): Promise<string> =>
    (await run('git', ['rev-parse', 'HEAD'], cwd)).stdout.trim()
  try {
    if (!existsSync(path.join(cwd, 'CHANGELOG.md'))) {
      return await headSha()
    }
    // The oldest root reachable from HEAD — the last squash's root (or the true
    // start). Commits after it are the window this squash would otherwise erase.
    const roots = (
      await run('git', ['rev-list', '--max-parents=0', 'HEAD'], cwd)
    ).stdout
      .trim()
      .split('\n')
      .filter(Boolean)
    const root = roots[roots.length - 1]
    if (!root) {
      return await headSha()
    }
    const log = (
      await run(
        'git',
        ['log', `${root}..HEAD`, `--format=${COMMIT_LOG_FORMAT}`],
        cwd,
      )
    ).stdout
    const section = generateChangelogSection({
      commits: parseConventionalCommits(log),
      date: '',
      heading: UNRELEASED_HEADING,
      repoUrl: repoBaseUrl(repoUrl),
      version: '',
    })
    if (!sectionHasEntries(section)) {
      logger.substep('changelog accrual: no user-visible commits to accrue')
      return await headSha()
    }
    const changelogPath = path.join(cwd, 'CHANGELOG.md')
    writeFileSync(
      changelogPath,
      mergeUnreleased(readFileSync(changelogPath, 'utf8'), section),
    )
    await run(
      'git',
      [
        'commit',
        '--no-verify',
        '-o',
        'CHANGELOG.md',
        '-m',
        'docs(changelog): accrue [Unreleased] before squash',
      ],
      cwd,
      { env: { SQUASH_HISTORY: '1' } },
    )
    logger.substep('changelog accrual: [Unreleased] updated before squash')
    return await headSha()
  } catch (e) {
    logger.warn(
      `changelog accrual skipped (squash proceeds): ${errorMessage(e)}`,
    )
    return await headSha()
  }
}

export interface SquashOptions {
  /**
   * Commit subject for the collapsed commit. Defaults to
   * 'chore: initial commit'.
   */
  readonly message?: string | undefined
  /**
   * Pre-squash SHA the post-squash tree must match exactly. A mismatch is a
   * HARD failure — the function calls process.exit(1) rather than returning.
   */
  readonly origHead: string
  /**
   * Sign the collapsed commit and assert the signature verifies (`%G?` == 'G').
   * Needed where branch protection mandates `required_signatures`
   * (refreshing-history). Defaults to false.
   */
  readonly sign?: boolean | undefined
  /**
   * Worktree directory the squash runs in (never the primary checkout).
   */
  readonly worktree: string
}

export interface SquashResult {
  readonly newHead: string
}

/**
 * Collapse the worktree's branch to a single commit via soft-reset onto the
 * root commit followed by an amend, then assert exactly one commit remains and
 * the tree is byte-identical to `origHead`. A tree mismatch is unrecoverable
 * corruption of intent, so it triggers a HARD `process.exit(1)`.
 *
 * The SQUASH_HISTORY=1 sentinel on the amend scopes the no-revert-guard
 * `--no-verify` bypass to exactly this one command.
 */
export async function squashSingleCommit(
  config: SquashOptions,
): Promise<SquashResult> {
  const cfg = { __proto__: null, ...config } as {
    message?: string | undefined
    origHead: string
    sign?: boolean | undefined
    worktree: string
  }
  const message = cfg.message ?? 'chore: initial commit'
  const sign = cfg.sign ?? false
  const { origHead, worktree } = cfg

  // Soft-reset onto the root commit (keeps every change staged), then amend the
  // root so the result is a single commit — not root + 1.
  const firstCommit = (
    await run('git', ['rev-list', '--max-parents=0', 'HEAD'], worktree)
  ).stdout
  await run('git', ['reset', '--soft', firstCommit], worktree)
  // -S signs via the user's configured key; the bare commit.gpgsign config is
  // unreliable for amend in a fresh worktree, so pass the flag explicitly.
  const amendArgs = sign
    ? ['commit', '--amend', '--no-verify', '-S', '-m', message]
    : ['commit', '--amend', '--no-verify', '-m', message]
  await run('git', amendArgs, worktree, { env: { SQUASH_HISTORY: '1' } })

  const newCount = (await run('git', ['rev-list', '--count', 'HEAD'], worktree))
    .stdout
  if (newCount !== '1') {
    throw new Error(`post-squash commit count is ${newCount}, expected 1`)
  }
  if (sign) {
    const sig = (await run('git', ['log', '--format=%G?', '-1'], worktree))
      .stdout
    if (sig !== 'G') {
      throw new Error(`squashed commit not signed (got ${sig})`)
    }
  }

  // Integrity gate — the whole point is zero content change. A non-empty diff
  // means the squash altered the tree; that is corruption, so exit hard.
  const diff = await run(
    'git',
    ['diff', '--ignore-submodules', origHead],
    worktree,
    { allowFailure: true },
  )
  if (diff.stdout.length > 0) {
    logger.error(`post-squash diff vs ${origHead} non-empty; aborting`)
    logger.error(diff.stdout.split('\n').slice(0, 20).join('\n'))
    process.exit(1)
  }

  const newHead = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout
  return { __proto__: null, newHead } as SquashResult
}

/**
 * Mint a single root commit whose tree is byte-identical to `tipSha`'s tree,
 * via `git commit-tree` — pure object creation, so neither the index nor the
 * working tree of `cwd` is touched and no worktree is needed. Signs with the
 * user's configured key and asserts the signature verifies.
 */
export async function mintSquashRoot(config: {
  readonly cwd: string
  readonly message?: string | undefined
  readonly tipSha: string
}): Promise<SquashResult> {
  const cfg = { __proto__: null, ...config } as {
    cwd: string
    message?: string | undefined
    tipSha: string
  }
  const { cwd, tipSha } = cfg
  const message = cfg.message ?? 'chore: initial commit'
  const newHead = (
    await run(
      'git',
      ['commit-tree', '-S', `${tipSha}^{tree}`, '-m', message],
      cwd,
    )
  ).stdout.trim()
  // Integrity gate — the whole point is zero content change. A non-empty
  // diff means the mint altered the tree; that is corruption, so exit hard.
  const diff = await run(
    'git',
    ['diff', '--ignore-submodules', newHead, tipSha],
    cwd,
    {
      allowFailure: true,
    },
  )
  if (diff.stdout.length > 0) {
    logger.error(`minted-root diff vs ${tipSha} non-empty; aborting`)
    logger.error(diff.stdout.split('\n').slice(0, 20).join('\n'))
    process.exit(1)
  }
  const sig = (
    await run('git', ['log', '--format=%G?', '-1', newHead], cwd)
  ).stdout.trim()
  if (sig !== 'G') {
    throw new Error(`minted root not signed (got ${sig})`)
  }
  return { __proto__: null, newHead } as SquashResult
}

export type SquashMode = 'origin' | 'local-canonical' | 'diverged'

export interface ClassifySquashModeOptions {
  /**
   * Local branch tip sha, or `''` when there is no local branch.
   */
  readonly localHead: string
  /**
   * Origin/<base> tip sha.
   */
  readonly origHead: string
  /**
   * Whether origin's tip is an ancestor of the local branch tip.
   */
  readonly originIsAncestor: boolean
}

/**
 * Classify the squash mode from the local branch tip, the origin tip, and
 * whether origin is an ancestor of local (`''` localHead = no local branch):
 *
 * - `origin`: no local branch, or local == origin — squash origin's history.
 * - `local-canonical`: local is ahead (origin is its ancestor) — squash the local
 *   tree; origin's tip is already contained.
 * - `diverged`: local and origin each hold commits the other lacks — MUST be
 *   refused. A blind squash mints the root from the local tree and
 *   force-pushes, dropping origin's commits (they survive only in a backup ref,
 *   never on the branch). Reconcile forward first (merge origin into local),
 *   then re-run.
 */
export function classifySquashMode(
  config: ClassifySquashModeOptions,
): SquashMode {
  const cfg = { __proto__: null, ...config } as ClassifySquashModeOptions
  if (cfg.localHead === '' || cfg.localHead === cfg.origHead) {
    return 'origin'
  }
  return cfg.originIsAncestor ? 'local-canonical' : 'diverged'
}

async function main(): Promise<number> {
  const src = process.argv[2]
  if (!src) {
    logger.error('usage: node run.mts <repo-path>')
    return 2
  }

  // Verify it's a real git checkout — trust git, not fs probes (cross-platform).
  try {
    await run('git', ['rev-parse', '--git-dir'], src)
  } catch {
    logger.error(`error: ${src} is not a git checkout`)
    return 2
  }

  // Resolve the checkout to its canonical fleet name (origin slug, EXACT — no
  // fuzzy fallback to a look-alike), then gate on the roster opt-in and the
  // published-release safeguard before anything destructive can start.
  const fleetName = await resolveFleetName(src)
  const allowedExit = await checkSquashAllowed({ fleetName, src })
  if (allowedExit !== undefined) {
    return allowedExit
  }

  const repoName = fleetName
  const worktree = `${src}-squash`
  const squashBranch = 'chore/squash'

  logger.info('============================================================')
  logger.info(`squashing-history: ${repoName}`)
  logger.info('============================================================')

  // Phase 1 — pre-flight.
  const base = await resolveDefaultBranch({ cwd: src })
  header('default branch', base)
  await run('git', ['fetch', 'origin', base], src)

  const shallowExit = await checkNotShallowClone({ base, src })
  if (shallowExit !== undefined) {
    return shallowExit
  }

  const origHead = (await run('git', ['rev-parse', `origin/${base}`], src))
    .stdout
  const origCount = (
    await run('git', ['rev-list', '--count', `origin/${base}`], src)
  ).stdout
  const backup = await backupBranchForCommit(src, origHead)
  header(`original ${base}`, `${origHead} (${origCount} commits)`)

  // Origin URL, for the changelog accrual's release links (best-effort).
  const remoteUrl =
    (
      await run('git', ['config', '--get', 'remote.origin.url'], src, {
        allowFailure: true,
      })
    ).stdout.trim() || undefined

  // Local main is canonical in the fleet. When the local branch is AHEAD of
  // origin (origin is its ancestor), the squash must collapse the LOCAL tree
  // — squashing origin's stale tree would mint a root missing local work and
  // the next push would obliterate the squash. When local and origin have
  // DIVERGED (each has commits the other lacks), refuse loudly: reconcile
  // forward first (merge origin into local), then re-run.
  let localHead = ''
  try {
    localHead = (
      await run('git', ['rev-parse', `refs/heads/${base}`], src)
    ).stdout.trim()
  } catch {}
  const localMode = localHead !== '' && localHead !== origHead
  if (localMode) {
    return await squashLocalCanonicalMode({
      base,
      localHead,
      origHead,
      remoteUrl,
      repoName,
      src,
    })
  }

  return await squashWorktreeMode({
    backup,
    base,
    origCount,
    origHead,
    remoteUrl,
    repoName,
    squashBranch,
    src,
    worktree,
  })
}

// Run as a CLI only when invoked directly, not when imported by a sibling (e.g.
// refreshing-history/run.mts) or a test that reuses squashSingleCommit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then(code => {
      process.exitCode = code
    })
    .catch((e: unknown) => {
      const message = isError(e) ? e.message : errorMessage(e)
      logger.error(`squashing-history failed: ${message}`)
      process.exitCode = 1
    })
}
