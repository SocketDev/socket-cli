/*
 * Squashing-history runner — the top-level squash-mode implementations.
 *
 * `squashLocalCanonicalMode` collapses local main's own tree when local is
 * ahead of origin AND there is no published-release freeze boundary;
 * `squashWorktreeMode` runs the standard worktree-based full-root squash
 * (Phases 2-8 in run.mts's header table) when local and origin already agree
 * and there is no boundary; `squashTailMode` runs whenever a boundary EXISTS
 * (either dispatch shape — local-ahead or origin-agrees), collapsing only the
 * unreleased tail above the frozen release. Split out of run.mts to keep
 * main()'s body to a thin dispatch — resolve which mode applies, hand off,
 * return the exit code.
 */
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { resolveDefaultBranch } from '../_shared/scripts/git-default-branch.mts'
import { header, run } from '../_shared/scripts/run-helpers.mts'
import { checkNotShallowClone } from './run-guards.mts'
import {
  accrueUnreleased,
  assertBoundaryIntact,
  backupBranchForCommit,
  classifySquashMode,
  mintSquashRoot,
  refuseIfDiverged,
  squashSingleCommit,
} from './run.mts'

const logger = getDefaultLogger()

/**
 * Squash local main's own tree onto a freshly minted root and force-push it,
 * for the case where local is ahead of origin, origin is local's ancestor.
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

  // Diverged: origin holds commits the local branch lacks. Local is
  // canonical, but a blind squash mints the root from the local tree and
  // force-pushes — dropping origin's commits (they would survive only in a
  // backup ref, never on the branch). Refuse loudly; the caller must
  // reconcile FORWARD, fold origin's commits into local, then re-run.
  const diverged = await refuseIfDiverged({ base, localHead, origHead, src })
  if (diverged !== undefined) {
    return diverged
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

  // Phase 2 — worktree, clean any stale state from prior runs.
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

  // Phase 6 — force-push, lease guards against a racing push.
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

/**
 * Collapse ONLY the unreleased tail above a frozen published-release boundary
 * — every commit from the repo root through `boundary` stays byte-identical
 * (the published release's SHA, so its provenance / SHA pins / tags keep
 * resolving); `boundary..tip` collapses to one FRESH signed commit
 * (`amend: false` — the boundary itself is a published release commit and
 * must never be rewritten).
 *
 * Runs in its OWN worktree checked out at `tip` (never a reset in `src`), so
 * this covers BOTH default-branch dispatch shapes: `tip` is origin's tip when
 * local matches origin, or local's tip when local is ahead — a `-p <boundary>`
 * parent plus a `reset --soft` that mutates an index needs a worktree either
 * way, unlike the local-canonical full-root path's parent-less `commit-tree`
 * mint. This is why a repo with a resolved boundary never reaches
 * `squashLocalCanonicalMode` or `squashWorktreeMode` — both rewrite the ROOT,
 * which would orphan the released commits below the boundary.
 */
export async function squashTailMode(config: {
  readonly base: string
  readonly boundary: string
  readonly leaseAgainst: string
  readonly remoteUrl: string | undefined
  readonly repoName: string
  /**
   * Sign the collapsed commit and assert the signature verifies. Defaults to
   * `true` (fleet branch protection mandates `required_signatures`); tests
   * pass `false` to run without a configured signing key.
   */
  readonly sign?: boolean | undefined
  readonly src: string
  readonly tip: string
  readonly worktree: string
}): Promise<number> {
  const cfg = { __proto__: null, ...config } as {
    base: string
    boundary: string
    leaseAgainst: string
    remoteUrl: string | undefined
    repoName: string
    sign?: boolean | undefined
    src: string
    tip: string
    worktree: string
  }
  const {
    base,
    boundary,
    leaseAgainst,
    remoteUrl,
    repoName,
    src,
    tip,
    worktree,
  } = cfg
  const sign = cfg.sign ?? true
  const squashBranch = 'chore/squash-tail'

  // No-op early return: count boundary..tip (like the feature-branch mode's
  // aheadCount), never the total commit count — a frozen repo's total count is
  // never 1, so that check would never no-op.
  const aheadCount = (
    await run('git', ['rev-list', '--count', `${boundary}..${tip}`], src)
  ).stdout
  header(
    `${base} tail`,
    `${tip} (${aheadCount} commits past frozen release ${boundary.slice(0, 8)})`,
  )
  if (aheadCount === '0' || aheadCount === '1') {
    logger.info(
      `${base} is already squashed past the frozen release — nothing to collapse`,
    )
    return 0
  }

  // Worktree off the TIP being collapsed — never a reset in src.
  await run('git', ['worktree', 'remove', '--force', worktree], src, {
    allowFailure: true,
  })
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })
  await run('git', ['worktree', 'add', '-b', squashBranch, worktree, tip], src)

  // Remote backup ref of the pre-squash tip, BEFORE any rewrite.
  const backup = await backupBranchForCommit(src, tip)
  logger.substep(`pushing remote backup ref: refs/heads/${backup} -> ${tip}`)
  await run(
    'git',
    ['push', '--no-verify', 'origin', `${tip}:refs/heads/${backup}`],
    worktree,
  )

  // Accrue [Unreleased] since the FROZEN BOUNDARY, never the repo root — the
  // released commits below it are already under their own version heading in
  // CHANGELOG.md and must never re-accrue into [Unreleased] every cadence.
  const accruedTip = await accrueUnreleased(worktree, remoteUrl, boundary)

  // Squash + integrity (shared engine; HARD exit on a tree mismatch). A FRESH
  // commit on the boundary (amend:false) — the boundary is the published
  // release commit and must never be rewritten.
  const { newHead } = await squashSingleCommit({
    amend: false,
    message: 'chore: squash unreleased history',
    origHead: accruedTip,
    resetTo: boundary,
    sign,
    worktree,
  })
  logger.success(
    `squashed ${aheadCount} unreleased commits → 1 commit (${newHead})`,
  )
  logger.success('integrity: post-squash tail tree == pre-squash tail tree')

  // Runtime boundary assertion — the released commit below the tail must
  // stay byte-identical and reachable; this is the whole point of tail mode.
  await assertBoundaryIntact(worktree, boundary)

  // Force-push, lease guards against a racing push.
  logger.substep(`force-pushing to ${base}...`)
  await run(
    'git',
    [
      'push',
      '--no-verify',
      `--force-with-lease=${base}:${leaseAgainst}`,
      'origin',
      `HEAD:${base}`,
    ],
    worktree,
    { env: { SQUASH_HISTORY: '1' } },
  )

  // Cleanup — remove the worktree and its branch from src.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })

  logger.log('')
  logger.success(
    `${repoName} squashed (tail mode — frozen release ${boundary.slice(0, 8)} kept intact)`,
  )
  logger.substep(`new ${base}:      ${newHead}`)
  logger.substep(`frozen boundary: ${boundary}`)
  logger.substep(`backup ref: refs/heads/${backup} -> ${tip}`)
  logger.substep(
    `recover:    git fetch origin ${backup} && git push --force origin FETCH_HEAD:${base}`,
  )
  return 0
}

/**
 * Squash an author-agreed FEATURE branch down to a single commit on its PR
 * base's merge-base, reusing the same worktree engine as the default-branch
 * flow. Resolve the canonical tip (local is canonical in the fleet: local ==
 * origin or no local branch → origin tip; local ahead of origin → local tip;
 * two-way divergence → REFUSE, same contract as the default-branch flow), push
 * a remote backup ref of that tip BEFORE any rewrite, soft-reset a worktree
 * onto the merge-base, make ONE signed collapse commit, HARD-verify its tree is
 * byte-identical to the pre-squash tip (`squashSingleCommit` exits non-zero on
 * a mismatch), then lease-push it to the branch under the SQUASH_HISTORY=1
 * sentinel.
 *
 * No roster opt-in / published-release gate: it rewrites only the named branch,
 * never the repo's published default-branch history. The safety that matters
 * for a feature squash — backup ref + byte-identical tree + lease push +
 * divergence refusal — is preserved exactly.
 *
 * `sign` defaults to true (fleet branch protection enforces
 * required_signatures); tests pass `false` to run without a configured key.
 */
export async function squashFeatureBranchMode(config: {
  readonly base?: string | undefined
  readonly branch: string
  readonly message?: string | undefined
  readonly sign?: boolean | undefined
  readonly src: string
}): Promise<number> {
  const cfg = { __proto__: null, ...config } as {
    base?: string | undefined
    branch: string
    message?: string | undefined
    sign?: boolean | undefined
    src: string
  }
  const { branch, src } = cfg
  const sign = cfg.sign ?? true

  // Filesystem-safe suffix so `feat/x` doesn't create nested worktree dirs.
  const safe = branch.replace(/[^A-Za-z0-9._-]/g, '-')
  const worktree = `${src}-squash-${safe}`
  const squashBranch = `chore/squash-${safe}`

  // PR base for the merge-base: an explicit --base, else the default branch.
  const base = cfg.base ?? (await resolveDefaultBranch({ cwd: src }))
  header('feature branch', branch)
  header('base', base)

  // Fetch the base (needed for the merge-base) and the feature branch
  // (best-effort — a not-yet-pushed local branch has no origin ref).
  await run('git', ['fetch', 'origin', base], src, { allowFailure: true })
  await run('git', ['fetch', 'origin', branch], src, { allowFailure: true })

  const shallowExit = await checkNotShallowClone({ base, src })
  if (shallowExit !== undefined) {
    return shallowExit
  }

  // Base commit for the merge-base: prefer origin/<base>, fall back to a local
  // ref so a base branch that only exists locally still resolves.
  const revParseQuiet = async (ref: string): Promise<string> =>
    (
      await run('git', ['rev-parse', '--verify', '--quiet', ref], src, {
        allowFailure: true,
      })
    ).stdout.trim()
  const baseSha =
    (await revParseQuiet(`refs/remotes/origin/${base}`)) ||
    (await revParseQuiet(`refs/heads/${base}`))
  if (!baseSha) {
    logger.error(
      `error: base ref ${base} not found (origin/${base} or refs/heads/` +
        `${base}) — pass --base <ref>.`,
    )
    return 2
  }

  // Resolve the branch tip. Local is canonical; refuse a two-way divergence.
  const localHead = await revParseQuiet(`refs/heads/${branch}`)
  const originHead = await revParseQuiet(`refs/remotes/origin/${branch}`)
  if (localHead === '' && originHead === '') {
    logger.error(`error: branch ${branch} not found locally or on origin.`)
    return 2
  }

  let tip: string
  // Origin sha to pin the lease against; undefined when the branch is not on
  // origin yet (first push of a local-only branch).
  let leaseAgainst: string | undefined
  if (localHead === '') {
    tip = originHead
    leaseAgainst = originHead
  } else if (originHead === '' || localHead === originHead) {
    tip = localHead
    leaseAgainst = originHead === '' ? undefined : originHead
  } else {
    const originIsAncestor =
      (
        await run(
          'git',
          ['merge-base', '--is-ancestor', originHead, localHead],
          src,
          { allowFailure: true },
        )
      ).code === 0
    if (
      classifySquashMode({
        localHead,
        origHead: originHead,
        originIsAncestor,
      }) === 'diverged'
    ) {
      logger.error(
        `error: origin/${branch} (${originHead.slice(0, 8)}) has commits your ` +
          `local ${branch} lacks — they have DIVERGED. Squashing now would ` +
          `drop origin's commits. Fix: reconcile forward first — ` +
          `git -C ${src} merge --no-edit origin/${branch} (resolve conflicts), ` +
          `then re-run.`,
      )
      return 2
    }
    tip = localHead
    leaseAgainst = originHead
  }

  const mergeBase = (
    await run('git', ['merge-base', tip, baseSha], src, { allowFailure: true })
  ).stdout.trim()
  if (!mergeBase) {
    logger.error(
      `error: no merge-base between ${branch} and ${base} — unrelated ` +
        `histories.`,
    )
    return 2
  }
  if (mergeBase === tip) {
    logger.error(
      `error: ${branch} has no commits past ${base} — nothing to squash.`,
    )
    return 2
  }

  const aheadCount = (
    await run('git', ['rev-list', '--count', `${mergeBase}..${tip}`], src)
  ).stdout
  header(branch, `${tip} (${aheadCount} commits past ${base})`)
  if (aheadCount === '1') {
    logger.info(
      `${branch} is already a single commit past ${base} — nothing to squash`,
    )
    return 0
  }

  // Default the collapsed subject to the branch tip's own subject (usually the
  // PR title after iteration); fall back to the canonical squash message.
  let message = cfg.message
  if (message === undefined || message === '') {
    message =
      (
        await run('git', ['log', '-1', '--format=%s', tip], src)
      ).stdout.trim() || 'chore: initial commit'
  }

  const backup = await backupBranchForCommit(src, tip)

  // Remote backup ref BEFORE any rewrite — the pre-squash tip stays
  // recoverable. --no-verify: pushing an existing, already-validated tip.
  logger.substep(`pushing remote backup ref: refs/heads/${backup} -> ${tip}`)
  await run(
    'git',
    ['push', '--no-verify', 'origin', `${tip}:refs/heads/${backup}`],
    src,
  )

  // Worktree off the tip; clear any stale state from a prior run first.
  await run('git', ['worktree', 'remove', '--force', worktree], src, {
    allowFailure: true,
  })
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })
  await run('git', ['worktree', 'add', '-b', squashBranch, worktree, tip], src)

  // Squash + integrity (shared engine; HARD exit on tree mismatch). amend:false
  // makes a FRESH commit on the merge-base — never rewrite the shared base.
  const { newHead } = await squashSingleCommit({
    amend: false,
    message,
    origHead: tip,
    resetTo: mergeBase,
    sign,
    worktree,
  })
  logger.success(`squashed ${aheadCount} commits → 1 commit (${newHead})`)
  logger.success('integrity: post-squash tree == pre-squash tree')

  // Lease-push. Pin the lease to origin's current tip when the branch exists
  // there; a first push of a local-only branch has nothing to pin.
  const leaseFlag = leaseAgainst
    ? `--force-with-lease=${branch}:${leaseAgainst}`
    : '--force-with-lease'
  logger.substep(`force-pushing to ${branch}...`)
  await run(
    'git',
    ['push', '--no-verify', leaseFlag, 'origin', `HEAD:${branch}`],
    worktree,
    { env: { SQUASH_HISTORY: '1' } },
  )

  // Move the local branch to the squashed commit when it is safe to do so, so
  // local doesn't read as diverged from origin right after the squash.
  if (localHead !== '') {
    const srcBranch = (
      await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], src, {
        allowFailure: true,
      })
    ).stdout.trim()
    if (srcBranch === branch) {
      logger.substep(
        `local ${branch} is checked out in ${src}; sync it with: ` +
          `git -C ${src} reset --hard ${newHead}`,
      )
    } else {
      await run(
        'git',
        ['update-ref', `refs/heads/${branch}`, newHead, localHead],
        src,
      )
      logger.substep(`local ${branch} moved to ${newHead}`)
    }
  }

  // Cleanup.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })

  // Report.
  logger.log('')
  logger.success(`${branch} squashed (feature-branch mode)`)
  logger.substep(`new ${branch}: ${newHead}`)
  logger.substep(`backup ref: refs/heads/${backup} -> ${tip}`)
  logger.substep(
    `recover:    git fetch origin ${backup} && git push --force origin FETCH_HEAD:${branch}`,
  )
  return 0
}
