/**
 * Branch operations for Socket CLI's git utilities: checkout, create,
 * delete, push, existence checks, and default/base-branch detection.
 *
 * Extracted from operations.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { isDebug } from '@socketsecurity/lib-stable/debug/namespace'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import {
  getGithubBaseRef,
  getGithubRefName,
  getGithubRefType,
} from '@socketsecurity/lib-stable/env/github'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLAG_QUIET } from '../../constants/cli.mts'
import { SOCKET_DEFAULT_BRANCH } from '../../constants/socket.mts'
import { debugGit } from '../debug.mts'
import { getGitPath } from './git-path.mts'

import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

// Listed in order of check preference.
const COMMON_DEFAULT_BRANCH_NAMES = [
  // Modern default (GitHub, GitLab, Bitbucket have switched to this).
  'main',
  // inclusive-language: external-api — git's historical default branch.
  'master',
  // Common in Git Flow workflows (main for stable, develop for ongoing work).
  'develop',
  // Used by teams adopting trunk-based development practices.
  'trunk',
  // Used in some older enterprise setups and tools.
  'default',
]

/**
 * Try to detect the default branch name by checking common patterns. Returns
 * the first branch that exists in the repository.
 */
export async function detectDefaultBranch(
  cwd = process.cwd(),
): Promise<string> {
  // First pass: check all local branches
  for (
    let i = 0, { length } = COMMON_DEFAULT_BRANCH_NAMES;
    i < length;
    i += 1
  ) {
    const branch = COMMON_DEFAULT_BRANCH_NAMES[i]!
    if (await gitLocalBranchExists(branch, cwd)) {
      return branch
    }
  }
  // Second pass: check remote branches only if no local branch found
  for (
    let i = 0, { length } = COMMON_DEFAULT_BRANCH_NAMES;
    i < length;
    i += 1
  ) {
    const branch = COMMON_DEFAULT_BRANCH_NAMES[i]!
    if (await gitRemoteBranchExists(branch, cwd)) {
      return branch
    }
  }
  return SOCKET_DEFAULT_BRANCH
}

export async function getBaseBranch(cwd = process.cwd()): Promise<string> {
  // 1. In a pull request, this is always the base branch.
  const githubBaseRef = getGithubBaseRef()
  if (githubBaseRef) {
    return githubBaseRef
  }
  // 2. If it's a branch (not a tag), GITHUB_REF_TYPE should be 'branch'.
  const githubRefType = getGithubRefType()
  const githubRefName = getGithubRefName()
  if (githubRefType === 'branch' && githubRefName) {
    return githubRefName
  }
  // 3. Try to resolve the default remote branch using 'git remote show origin'.
  // This handles detached HEADs or workflows triggered by tags/releases.
  try {
    const gitBin = await getGitPath()
    const result = await spawn(gitBin, ['remote', 'show', 'origin'], { cwd })

    if (!result) {
      return 'main'
    }

    const originDetails = result.stdout

    const match = /(?<=HEAD branch: ).+/.exec(originDetails)
    if (match && match.length > 0 && match[0]) {
      return match[0].trim()
    }
  } catch {}
  // GitHub and GitLab default to branch name "main"
  // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches#about-the-default-branch
  return 'main'
}

export async function gitCheckoutBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    const gitBin = await getGitPath()
    await spawn(gitBin, ['checkout', branch], stdioIgnoreOptions)
    debugGit(`checkout ${branch}`, true)
    return true
  } catch (e) {
    debugGit(`checkout ${branch}`, false, { error: e })
  }
  return false
}

export async function gitCreateBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  if (await gitLocalBranchExists(branch)) {
    return true
  }
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    const gitBin = await getGitPath()
    await spawn(gitBin, ['branch', branch], stdioIgnoreOptions)
    debugGit(`branch ${branch}`, true)
    return true
  } catch (e) {
    debugGit(`branch ${branch}`, false, { error: e })
  }
  return false
}

export async function gitDeleteBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    // Will throw with exit code 1 if branch does not exist.
    const gitBin = await getGitPath()
    await spawn(gitBin, ['branch', '-D', branch], stdioIgnoreOptions)
    return true
  } catch (e) {
    // Expected failure when branch doesn't exist.
    debugDir({
      message: `Branch deletion failed (may not exist): ${branch}`,
      error: e,
    })
  }
  return false
}

export async function gitDeleteRemoteBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    // Will throw with exit code 1 if branch does not exist.
    await spawn(
      'git',
      ['push', 'origin', '--delete', branch],
      stdioIgnoreOptions,
    )
    return true
  } catch (e) {
    // Expected failure when remote branch doesn't exist.
    debugDir({
      message: `Remote branch deletion failed (may not exist): ${branch}`,
      error: e,
    })
  }
  return false
}

export async function gitLocalBranchExists(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    // Will throw with exit code 1 if the branch does not exist.
    await spawn(
      'git',
      ['show-ref', FLAG_QUIET, `refs/heads/${branch}`],
      stdioIgnoreOptions,
    )
    return true
  } catch {
    // Expected when branch doesn't exist - no logging needed.
  }
  return false
}

export async function gitPushBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    await spawn(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      stdioIgnoreOptions,
    )
    debugGit(`push ${branch}`, true)
    return true
  } catch (e) {
    if (isSpawnError(e) && e.code === 128) {
      debug(
        "Push denied: token requires write permissions for 'contents' and 'pull-requests'",
      )
      debugDir(e)
      debugDir({ branch })
    } else {
      debugGit(`push ${branch}`, false, { error: e })
    }
  }
  return false
}

export async function gitRemoteBranchExists(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  try {
    const lsRemoteResult = await spawn(
      'git',
      ['ls-remote', '--heads', 'origin', branch],
      stdioPipeOptions,
    )
    return lsRemoteResult.stdout.length > 0
  } catch (e) {
    // Expected when remote is not accessible or branch doesn't exist.
    debugDir({
      message: `Remote branch check failed: ${branch}`,
      error: e,
    })
  }
  return false
}
