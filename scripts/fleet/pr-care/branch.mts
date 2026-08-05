/*
 * @file Branch surgery for PR care: base-update by LOCAL rebase, squash to
 *   one SIGNED commit, and pinned-lease force pushes. The laws encoded:
 *
 *   - Server-side `gh pr update-branch --rebase` is unreliable (5xx across whole
 *     batches) — the local rebase in a worktree is the path of record.
 *   - Rebase and push never chain in one step: a rebase can pause on a conflict,
 *     and anything chained after it acts on a half-rebased tree. On conflict
 *     this module ABORTS and reports a skip.
 *   - The remote tracking ref is force-fetched before every lease computation: PR
 *     branches get force-pushed upstream, so a stale tracking ref makes the
 *     lease pin a lie.
 *   - A minted squash commit is SIGNED (`commit-tree -S`) with the branch's final
 *     tree and a single parent at the base tip; `update-ref` then moves the
 *     branch without touching the worktree, because the tree is
 *     byte-identical.
 *   - A branch already checked out in a worktree rebases in place; anything else
 *     cycles through one scratch worktree.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export interface GitRunner {
  (
    cwd: string,
    args: readonly string[],
  ): Promise<{ exitCode: number; stdout: string }>
}

export async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string }> {
  try {
    const result = await spawn('git', [...args], {
      cwd,
      stdio: 'pipe',
      stdioString: true,
    })
    return { exitCode: result.code ?? 0, stdout: result.stdout ?? '' }
  } catch (e) {
    const spawnError = e as {
      code?: number | undefined
      stdout?: unknown | undefined
    }
    return {
      exitCode: typeof spawnError.code === 'number' ? spawnError.code : 1,
      stdout: String(spawnError.stdout ?? ''),
    }
  }
}

/**
 * The forced tracking-ref refspec for `branch`. Built here, not inline in a
 * shell, because `$BR:refs/…` in zsh reads `:r` as a history modifier and
 * silently mangles the ref.
 */
export function trackingRefspec(branch: string): string {
  return `+refs/heads/${branch}:refs/remotes/origin/${branch}`
}

/**
 * The pinned-lease flag for a force push: refuses at the server if origin
 * moved past the sha we fetched.
 */
export function leaseFlag(branch: string, fetchedSha: string): string {
  return `--force-with-lease=${branch}:${fetchedSha}`
}

export interface BranchUpdateResult {
  readonly branch: string
  readonly detail: string
  readonly outcome: 'conflict-skipped' | 'pushed' | 'up-to-date'
}

/**
 * Fetch the branch's tracking ref (forced) and return its sha, or undefined
 * when the branch does not exist on origin.
 */
export async function fetchTrackingSha(
  checkout: string,
  branch: string,
  git: GitRunner = runGit,
): Promise<string | undefined> {
  const fetched = await git(checkout, [
    'fetch',
    'origin',
    trackingRefspec(branch),
  ])
  if (fetched.exitCode !== 0) {
    return undefined
  }
  const sha = await git(checkout, [
    'rev-parse',
    `refs/remotes/origin/${branch}`,
  ])
  return sha.exitCode === 0 ? sha.stdout.trim() : undefined
}

/**
 * The worktree directory already holding `branch`, or undefined. Reuses a
 * live checkout instead of fighting `worktree add` over branch ownership.
 */
export async function worktreeFor(
  checkout: string,
  branch: string,
  git: GitRunner = runGit,
): Promise<string | undefined> {
  const list = await git(checkout, ['worktree', 'list', '--porcelain'])
  if (list.exitCode !== 0) {
    return undefined
  }
  const blocks = list.stdout.split('\n\n')
  for (let i = 0, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    if (block.includes(`branch refs/heads/${branch}`)) {
      const line = block.split('\n').find(l => l.startsWith('worktree '))
      return line?.slice('worktree '.length)
    }
  }
  return undefined
}

/**
 * Rebase `branch` onto `origin/<base>` and push with a pinned lease. On a
 * conflict the rebase is aborted and the branch reported as skipped — the
 * resolution is judgment work for the operator.
 */
export async function rebaseAndPush(config: {
  readonly base: string
  readonly branch: string
  readonly checkout: string
  readonly git?: GitRunner | undefined
  readonly scratchDir: string
}): Promise<BranchUpdateResult> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { base, branch, checkout, scratchDir } = cfg
  const git = cfg.git ?? runGit
  const lease = await fetchTrackingSha(checkout, branch, git)
  if (!lease) {
    return {
      branch,
      detail: 'branch not found on origin',
      outcome: 'conflict-skipped',
    }
  }
  let dir = await worktreeFor(checkout, branch, git)
  let scratch = false
  if (!dir) {
    await git(checkout, ['worktree', 'remove', '--force', scratchDir])
    const added = await git(checkout, [
      'worktree',
      'add',
      '--force',
      '-B',
      branch,
      scratchDir,
      `origin/${branch}`,
    ])
    if (added.exitCode !== 0) {
      return {
        branch,
        detail: 'could not create a worktree',
        outcome: 'conflict-skipped',
      }
    }
    dir = scratchDir
    scratch = true
  }
  const rebased = await git(dir, ['rebase', `origin/${base}`])
  if (rebased.exitCode !== 0) {
    await git(dir, ['rebase', '--abort'])
    if (scratch) {
      await git(checkout, ['worktree', 'remove', '--force', scratchDir])
    }
    return {
      branch,
      detail: 'rebase conflict — aborted, resolve by hand',
      outcome: 'conflict-skipped',
    }
  }
  const tip = await git(dir, ['rev-parse', 'HEAD'])
  if (tip.stdout.trim() === lease) {
    if (scratch) {
      await git(checkout, ['worktree', 'remove', '--force', scratchDir])
    }
    return { branch, detail: 'already on the base tip', outcome: 'up-to-date' }
  }
  const pushed = await git(dir, [
    'push',
    leaseFlag(branch, lease),
    'origin',
    branch,
  ])
  if (scratch) {
    await git(checkout, ['worktree', 'remove', '--force', scratchDir])
  }
  if (pushed.exitCode !== 0) {
    return {
      branch,
      detail: 'push rejected — origin moved past the fetched lease',
      outcome: 'conflict-skipped',
    }
  }
  return { branch, detail: `pushed onto origin/${base}`, outcome: 'pushed' }
}

/**
 * Collapse a branch to ONE signed commit on `origin/<base>`: mint via
 * `commit-tree -S` with the branch's final tree, then move the ref. The
 * caller pushes separately (pinned lease), keeping the pausing-command law.
 */
export async function squashToOne(config: {
  readonly base: string
  readonly branch: string
  readonly dir: string
  readonly git?: GitRunner | undefined
  readonly message: string
}): Promise<{ detail: string; sha: string | undefined }> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { base, branch, dir, message } = cfg
  const git = cfg.git ?? runGit
  const baseSha = await git(dir, ['rev-parse', `origin/${base}`])
  if (baseSha.exitCode !== 0) {
    return { detail: `origin/${base} is not resolvable`, sha: undefined }
  }
  const minted = await git(dir, [
    'commit-tree',
    'HEAD^{tree}',
    '-S',
    '-p',
    baseSha.stdout.trim(),
    '-m',
    message,
  ])
  if (minted.exitCode !== 0) {
    return { detail: 'commit-tree failed (signing key?)', sha: undefined }
  }
  const sha = minted.stdout.trim()
  const moved = await git(dir, ['update-ref', `refs/heads/${branch}`, sha])
  if (moved.exitCode !== 0) {
    return { detail: 'update-ref failed', sha: undefined }
  }
  return { detail: `minted ${sha.slice(0, 9)}`, sha }
}
