/**
 * Branch cleanup utilities for socket fix command.
 * Manages local and remote branch lifecycle during PR creation.
 *
 * Critical distinction: Remote branches are sacred when a PR exists, disposable when they don't.
 */

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { gitDeleteBranch, gitDeleteRemoteBranch } from '../../utils/git.mts'

/**
 * Clean up a stale branch (both remote and local).
 * Safe to delete both since no PR exists for this branch.
 *
 * Returns true if cleanup succeeded or should continue, false if should skip GHSA.
 */
export async function cleanupStaleBranch(
  branch: string,
  ghsaId: string,
  cwd: string,
): Promise<boolean> {
  logger.warn(`Stale branch ${branch} found without open PR, cleaning up...`)
  debugFn('notice', `cleanup: deleting stale branch ${branch}`)

  const deleted = await gitDeleteRemoteBranch(branch, cwd)
  if (!deleted) {
    logger.error(
      `Failed to delete stale remote branch ${branch}, skipping ${ghsaId}.`,
    )
    debugFn('error', `cleanup: remote deletion failed for ${branch}`)
    return false
  }

  // Clean up local branch too to avoid conflicts.
  await gitDeleteBranch(branch, cwd)
  return true
}

/**
 * Clean up branches after PR creation failure.
 * Safe to delete both remote and local since no PR was created.
 */
export async function cleanupFailedPrBranches(
  branch: string,
  cwd: string,
): Promise<void> {
  // Clean up pushed branch since PR creation failed.
  // Safe to delete both remote and local since no PR exists.
  await gitDeleteRemoteBranch(branch, cwd)
  await gitDeleteBranch(branch, cwd)
}

/**
 * Clean up local branch after successful PR creation.
 * Keeps remote branch - PR needs it to be mergeable.
 */
export async function cleanupSuccessfulPrLocalBranch(
  branch: string,
  cwd: string,
): Promise<void> {
  // Clean up local branch only - keep remote branch for PR merge.
  await gitDeleteBranch(branch, cwd)
}

/**
 * Clean up branches in catch block after unexpected error.
 * Safe to delete both remote and local since no PR was created.
 */
export async function cleanupErrorBranches(
  branch: string,
  cwd: string,
  remoteBranchExists: boolean,
): Promise<void> {
  // Clean up remote branch if it exists (push may have succeeded before error).
  // Safe to delete both remote and local since no PR was created.
  if (remoteBranchExists) {
    await gitDeleteRemoteBranch(branch, cwd)
  }
  await gitDeleteBranch(branch, cwd)
}
