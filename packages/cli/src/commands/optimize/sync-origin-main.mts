/**
 * Fast-forward the default branch to origin before an optimize run.
 * Fast-forward only: a repo that diverged is left untouched and the reason
 * is logged, and a sync failure never fails the optimize run itself.
 *
 * Key Functions: - syncOriginMain: fetch origin and ff the checked-out
 * default branch when it is strictly behind.
 */

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { detectDefaultBranch } from '../../util/git/git-branch-ops.mts'
import {
  gitBranch,
  gitUnstagedModifiedFiles,
} from '../../util/git/git-remote-info.mts'
import { spawnGit } from '../../util/git/spawn-git.mts'

export type SyncOriginMainResult = {
  ok: boolean
  reason: string
  synced: boolean
}

export function skip(reason: string): SyncOriginMainResult {
  return { ok: true, reason, synced: false }
}

/**
 * Fetch origin and fast-forward the default branch when the checkout allows
 * it. Skips (logged, never an error) on a detached HEAD, a non-default
 * branch, a dirty tree, or an already-current ref. Fetches first so the
 * behind-check reads a fresh ref.
 */
export async function syncOriginMain(
  cwd: string,
): Promise<SyncOriginMainResult> {
  const logger = getDefaultLogger()

  try {
    const branch = await gitBranch(cwd)
    const defaultBranch = await detectDefaultBranch(cwd)
    if (branch !== defaultBranch) {
      return skip(
        `on ${branch === undefined ? 'a detached HEAD' : branch}, not ${defaultBranch}`,
      )
    }

    const dirtyCResult = await gitUnstagedModifiedFiles(cwd)
    if (dirtyCResult.ok && dirtyCResult.data.length > 0) {
      return skip('the working tree has unstaged changes')
    }

    try {
      await spawnGit(['fetch', 'origin', defaultBranch], { cwd })
    } catch (e) {
      debug('origin fetch failed during sync-origin-main')
      debugDir(e)
      return {
        ok: false,
        reason: `failed to fetch origin/${defaultBranch}`,
        synced: false,
      }
    }

    let behind: number
    try {
      const countResult = await spawnGit(
        ['rev-list', '--count', `HEAD..origin/${defaultBranch}`],
        { cwd },
      )
      behind = Number.parseInt(countResult.stdout.trim(), 10)
    } catch (e) {
      debug('behind-check failed during sync-origin-main')
      debugDir(e)
      return {
        ok: false,
        reason: `failed to compare HEAD against origin/${defaultBranch}`,
        synced: false,
      }
    }
    if (behind === 0) {
      return skip(`already current with origin/${defaultBranch}`)
    }

    try {
      await spawnGit(['merge', '--ff-only', `origin/${defaultBranch}`], {
        cwd,
      })
    } catch (e) {
      debug('fast-forward failed during sync-origin-main')
      debugDir(e)
      return {
        ok: false,
        reason: `cannot fast-forward to origin/${defaultBranch} (diverged)`,
        synced: false,
      }
    }

    logger.info(`Fast-forwarded ${defaultBranch} to origin/${defaultBranch}.`)
    return { ok: true, reason: '', synced: true }
  } catch (e) {
    // Not a git repository at all (fixture dirs, plain folders): the sync
    // simply does not apply.
    debug('sync-origin-main does not apply here')
    debugDir(e)
    return { ok: false, reason: 'not a git repository', synced: false }
  }
}
