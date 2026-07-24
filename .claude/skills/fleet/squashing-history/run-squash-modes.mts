/*
 * Squashing-history runner — the two top-level squash-mode implementations.
 *
 * `squashLocalCanonicalMode` collapses local main's own tree when local is
 * ahead of origin; `squashWorktreeMode` runs the standard worktree-based
 * squash (Phases 2-8 in run.mts's header table) when local and origin already
 * agree. Split out of run.mts to keep main()'s body to a thin dispatch —
 * resolve which mode applies, hand off, return the exit code.
 */
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { header, run } from '../_shared/scripts/run-helpers.mts'
import {
  accrueUnreleased,
  backupBranchForCommit,
  classifySquashMode,
  mintSquashRoot,
  squashSingleCommit,
} from './run.mts'

const logger = getDefaultLogger()

/**
 * Squash local main's own tree onto a freshly minted root and force-push it,
 * for the case where local is ahead of origin (origin is local's ancestor).
 * Refuses (exit 2) when local and origin have DIVERGED — a blind squash would
 * mint the root from the local tree and drop origin's commits.
 */
export async function squashLocalCanonicalMode(config: {
  readonly base: string
  readonly localHead: string
  readonly origHead: string
  readonly remoteUrl: string | undefined
  readonly repoName: string
  readonly src: string
}): Promise<number> {
  const cfg = { __proto__: null, ...config } as {
    base: string
    localHead: string
    origHead: string
    remoteUrl: string | undefined
    repoName: string
    src: string
  }
  const { base, origHead, remoteUrl, repoName, src } = cfg
  let { localHead } = cfg

  const originIsAncestor =
    (
      await run(
        'git',
        ['merge-base', '--is-ancestor', origHead, localHead],
        src,
        {
          allowFailure: true,
        },
      )
    ).code === 0
  if (
    classifySquashMode({ localHead, origHead, originIsAncestor }) === 'diverged'
  ) {
    // Diverged: origin holds commits the local branch lacks. Local is
    // canonical, but a blind squash mints the root from the local tree and
    // force-pushes — dropping origin's commits (they would survive only in a
    // backup ref, never on the branch). Refuse loudly; the caller must
    // reconcile FORWARD (fold origin's commits into local), then re-run.
    logger.error(
      `error: origin/${base} (${origHead.slice(0, 8)}) has commits your ` +
        `local ${base} lacks — local and origin have DIVERGED. Squashing ` +
        `now would drop origin's commits. Fix: reconcile forward first — ` +
        `git -C ${src} merge --no-edit origin/${base} (resolve any ` +
        `conflicts), then re-run.`,
    )
    return 2
  }
  const localCount = (await run('git', ['rev-list', '--count', localHead], src))
    .stdout
  header(
    `local ${base}`,
    `${localHead} (${localCount} commits, ahead of origin)`,
  )

  // Accrue the [Unreleased] changelog from the commits this squash collapses,
  // so they survive in the minted tree. Only when src is checked out on the
  // base branch (the accrual commits there and advances localHead); skip
  // otherwise so a detached / worktree checkout is never committed onto.
  const srcBranch = (
    await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], src, {
      allowFailure: true,
    })
  ).stdout.trim()
  if (srcBranch === base) {
    localHead = await accrueUnreleased(src, remoteUrl)
  } else {
    logger.substep(`changelog accrual: skipped (src not on ${base})`)
  }

  const localBackup = await backupBranchForCommit(src, localHead)

  // Backup the LOCAL tip before the rewrite so the pre-squash history is
  // always recoverable.
  logger.substep(
    `pushing remote backup ref: refs/heads/${localBackup} -> ${localHead}`,
  )
  await run(
    'git',
    ['push', '--no-verify', 'origin', `${localHead}:refs/heads/${localBackup}`],
    src,
  )

  const { newHead } = await mintSquashRoot({ cwd: src, tipSha: localHead })
  logger.success(`minted signed root ${newHead} from local ${base} tree`)

  // Point the local branch at the root (tree-identical, so the working
  // tree and index stay clean), then lease-push against origin's tip.
  await run(
    'git',
    ['update-ref', `refs/heads/${base}`, newHead, localHead],
    src,
  )
  logger.substep(`force-pushing to ${base}...`)
  await run(
    'git',
    [
      'push',
      '--no-verify',
      `--force-with-lease=${base}:${origHead}`,
      'origin',
      `${base}`,
    ],
    src,
    { env: { SQUASH_HISTORY: '1' } },
  )

  logger.log('')
  logger.success(`${repoName} squashed (local-canonical mode)`)
  logger.substep(`new ${base}:   ${newHead}`)
  logger.substep(`backup ref: refs/heads/${localBackup} -> ${localHead}`)
  logger.substep(
    `recover:    git fetch origin ${localBackup} && git push --force origin FETCH_HEAD:${base}`,
  )
  return 0
}

/**
 * Run the standard worktree-based squash — Phases 2 through 8 from run.mts's
 * header table — for the case where local main already matches origin (or
 * there is no local branch at all). No-ops when origin is already a single
 * commit.
 */
export async function squashWorktreeMode(config: {
  readonly backup: string
  readonly base: string
  readonly origCount: string
  readonly origHead: string
  readonly remoteUrl: string | undefined
  readonly repoName: string
  readonly squashBranch: string
  readonly src: string
  readonly worktree: string
}): Promise<number> {
  const cfg = { __proto__: null, ...config } as {
    backup: string
    base: string
    origCount: string
    origHead: string
    remoteUrl: string | undefined
    repoName: string
    squashBranch: string
    src: string
    worktree: string
  }
  const {
    backup,
    base,
    origCount,
    origHead,
    remoteUrl,
    repoName,
    squashBranch,
    src,
    worktree,
  } = cfg

  if (origCount === '1') {
    logger.info('already a single commit — nothing to squash')
    return 0
  }

  // Phase 2 — worktree (clean any stale state from prior runs).
  await run('git', ['worktree', 'remove', '--force', worktree], src, {
    allowFailure: true,
  })
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })
  await run(
    'git',
    ['worktree', 'add', '-b', squashBranch, worktree, `origin/${base}`],
    src,
  )

  // Phase 3 — remote backup ref.
  logger.substep(
    `pushing remote backup ref: refs/heads/${backup} -> ${origHead}`,
  )
  // --no-verify: the worktree is freshly added off origin/base with no
  // node_modules, so the repo's git pre-push hook (which imports
  // @socketsecurity/lib-stable) cannot load. A backup ref carries only the
  // existing, already-validated history; nothing new exists to verify.
  await run(
    'git',
    ['push', '--no-verify', 'origin', `${origHead}:refs/heads/${backup}`],
    worktree,
  )

  // Accrue the [Unreleased] changelog from the commits this squash collapses
  // (the worktree is on the squash branch, off origin/base). The accrual commit
  // becomes the new pre-squash tip the integrity gate matches against.
  const accruedHead = await accrueUnreleased(worktree, remoteUrl)

  // Phase 4 + 5 — squash + integrity (shared engine; HARD exit on mismatch).
  // sign: a fleet repo's default branch must carry signed commits, and GitHub
  // enforces required_signatures server-side regardless of --no-verify below.
  const { newHead } = await squashSingleCommit({
    origHead: accruedHead,
    sign: true,
    worktree,
  })
  logger.success(`squashed ${origCount} commits → 1 commit (${newHead})`)
  logger.success('integrity: post-squash tree == pre-squash tree')

  // Phase 6 — force-push (lease guards against a racing push).
  logger.substep(`force-pushing to ${base}...`)
  // --no-verify for the same reason as the backup push (no node_modules in the
  // worktree). The squash commit is already integrity-checked and
  // signature-asserted above, so the pre-push hook's checks are redundant.
  await run(
    'git',
    ['push', '--no-verify', '--force-with-lease', 'origin', `HEAD:${base}`],
    worktree,
    { env: { SQUASH_HISTORY: '1' } },
  )

  // Phase 7 — cleanup.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })

  // Phase 8 — report.
  logger.log('')
  logger.success(`${repoName} squashed`)
  logger.substep(`new ${base}:   ${newHead}`)
  logger.substep(`backup ref: refs/heads/${backup} -> ${origHead}`)
  logger.substep(
    `recover:    git fetch origin ${backup} && git push --force origin FETCH_HEAD:${base}`,
  )
  return 0
}
