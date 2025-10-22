/**
 * Git utilities for Socket CLI.
 * Provides git operations for repository management, branch handling, and commits.
 *
 * Branch Operations:
 * - gitCheckoutBranch: Switch to branch
 * - gitCreateBranch: Create new local branch
 * - gitDeleteBranch: Delete local branch
 * - gitDeleteRemoteBranch: Delete remote branch
 * - gitPushBranch: Push branch to remote with --force
 *
 * Commit Operations:
 * - gitCleanFdx: Remove untracked files
 * - gitCommit: Stage files and create commit
 * - gitEnsureIdentity: Configure git user.name/email
 * - gitResetHard: Reset to branch/commit
 *
 * Remote URL Parsing:
 * - parseGitRemoteUrl: Extract owner/repo from SSH or HTTPS URLs
 *
 * Repository Information:
 * - detectDefaultBranch: Find default branch (main/master/develop/etc)
 * - getBaseBranch: Determine base branch (respects GitHub Actions env)
 * - getRepoInfo: Extract owner/repo from git remote URL
 * - gitBranch: Get current branch or commit hash
 */

import { debug, debugDir, isDebug } from '@socketsecurity/lib/debug'
import { normalizePath } from '@socketsecurity/lib/path'
import { isSpawnError, spawn } from '@socketsecurity/lib/spawn'

import { FLAG_QUIET } from '../../constants/cli.mts'
import ENV from '../../constants/env.mts'
import {
  SOCKET_DEFAULT_BRANCH,
  SOCKET_DEFAULT_REPOSITORY,
} from '../../constants/socket.mts'
import { debugGit } from '../debug.mts'
import { extractName, extractOwner } from '../sanitize-names.mts'

import type { CResult } from '../../types.mjs'
import type { SpawnOptions } from '@socketsecurity/lib/spawn'

// Listed in order of check preference.
const COMMON_DEFAULT_BRANCH_NAMES = [
  // Modern default (GitHub, GitLab, Bitbucket have switched to this).
  'main',
  // Historic default in Git (pre-2020, still used in many repos).
  'master',
  // Common in Git Flow workflows (main for stable, develop for ongoing work).
  'develop',
  // Used by teams adopting trunk-based development practices.
  'trunk',
  // Used in some older enterprise setups and tools.
  'default',
]

export async function getBaseBranch(cwd = process.cwd()): Promise<string> {
  const { GITHUB_BASE_REF, GITHUB_REF_NAME, GITHUB_REF_TYPE } = ENV
  // 1. In a pull request, this is always the base branch.
  if (GITHUB_BASE_REF) {
    return GITHUB_BASE_REF
  }
  // 2. If it's a branch (not a tag), GITHUB_REF_TYPE should be 'branch'.
  if (GITHUB_REF_TYPE === 'branch' && GITHUB_REF_NAME) {
    return GITHUB_REF_NAME
  }
  // 3. Try to resolve the default remote branch using 'git remote show origin'.
  // This handles detached HEADs or workflows triggered by tags/releases.
  try {
    const result = await spawn('git', ['remote', 'show', 'origin'], { cwd })
    const originDetails =
      typeof result.stdout === 'string'
        ? result.stdout
        : result.stdout.toString('utf8')

    const match = /(?<=HEAD branch: ).+/.exec(originDetails)
    if (match?.[0]) {
      return match[0].trim()
    }
  } catch {}
  // GitHub and GitLab default to branch name "main"
  // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches#about-the-default-branch
  return 'main'
}

export type RepoInfo = {
  owner: string
  repo: string
}

export async function getRepoInfo(
  cwd = process.cwd(),
): Promise<RepoInfo | undefined> {
  let info: unknown
  try {
    const result = await spawn('git', ['remote', 'get-url', 'origin'], { cwd })
    const remoteUrl =
      typeof result.stdout === 'string'
        ? result.stdout
        : result.stdout.toString('utf8')
    info = parseGitRemoteUrl(remoteUrl)
    if (!info) {
      debug(`Unmatched git remote URL format: ${remoteUrl}`)
      debugDir({ remoteUrl })
    }
  } catch (e) {
    // Expected failure when not in a git repo.
    debugDir({ message: 'git remote get-url failed', error: e })
  }
  return info
}

export async function getRepoName(cwd = process.cwd()): Promise<string> {
  const repoInfo = await getRepoInfo(cwd)
  return repoInfo?.repo ? extractName(repoInfo.repo) : SOCKET_DEFAULT_REPOSITORY
}

export async function getRepoOwner(
  cwd = process.cwd(),
): Promise<string | undefined> {
  const repoInfo = await getRepoInfo(cwd)
  return repoInfo?.owner ? extractOwner(repoInfo.owner) : undefined
}

export async function gitBranch(
  cwd = process.cwd(),
): Promise<string | undefined> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  // Try symbolic-ref first which returns the branch name or fails in a
  // detached HEAD state.
  try {
    const gitSymbolicRefResult = await spawn(
      'git',
      ['symbolic-ref', '--short', 'HEAD'],
      stdioPipeOptions,
    )
    return typeof gitSymbolicRefResult.stdout === 'string'
      ? gitSymbolicRefResult.stdout
      : gitSymbolicRefResult.stdout.toString('utf8')
  } catch (e) {
    // Expected in detached HEAD state, fallback to rev-parse.
    debugDir({ message: 'In detached HEAD state', error: e })
  }
  // Fallback to using rev-parse to get the short commit hash in a
  // detached HEAD state.
  try {
    const gitRevParseResult = await spawn(
      'git',
      ['rev-parse', '--short', 'HEAD'],
      stdioPipeOptions,
    )
    return typeof gitRevParseResult.stdout === 'string'
      ? gitRevParseResult.stdout
      : gitRevParseResult.stdout.toString('utf8')
  } catch (e) {
    // Both methods failed, likely not in a git repo.
    debugDir({ message: 'Unable to determine git branch', error: e })
  }
  return undefined
}

/**
 * Try to detect the default branch name by checking common patterns.
 * Returns the first branch that exists in the repository.
 */
export async function detectDefaultBranch(
  cwd = process.cwd(),
): Promise<string> {
  // First pass: check all local branches
  for (const branch of COMMON_DEFAULT_BRANCH_NAMES) {
    // eslint-disable-next-line no-await-in-loop
    if (await gitLocalBranchExists(branch, cwd)) {
      return branch
    }
  }
  // Second pass: check remote branches only if no local branch found
  for (const branch of COMMON_DEFAULT_BRANCH_NAMES) {
    // eslint-disable-next-line no-await-in-loop
    if (await gitRemoteBranchExists(branch, cwd)) {
      return branch
    }
  }
  return SOCKET_DEFAULT_BRANCH
}

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    await spawn('git', ['clean', '-fdx'], stdioIgnoreOptions)
    debugGit('clean -fdx', true)
    return true
  } catch (e) {
    debugGit('clean -fdx', false, { error: e })
  }
  return false
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
    await spawn('git', ['checkout', branch], stdioIgnoreOptions)
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
    await spawn('git', ['branch', branch], stdioIgnoreOptions)
    debugGit(`branch ${branch}`, true)
    return true
  } catch (e) {
    debugGit(`branch ${branch}`, false, { error: e })
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

export async function gitCommit(
  commitMsg: string,
  filepaths: string[],
  options?: GitCreateAndPushBranchOptions | undefined,
): Promise<boolean> {
  if (!filepaths.length) {
    debug('miss: no filepaths to add')
    return false
  }
  const {
    cwd = process.cwd(),
    email = ENV.SOCKET_CLI_GIT_USER_EMAIL,
    user = ENV.SOCKET_CLI_GIT_USER_NAME,
  } = { __proto__: null, ...options } as GitCreateAndPushBranchOptions

  await gitEnsureIdentity(user || '', email || '', cwd)

  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    await spawn('git', ['add', ...filepaths], stdioIgnoreOptions)
    debugGit('add', true, { count: filepaths.length })
  } catch (e) {
    debugGit('add', false, { error: e })
    debugDir({ filepaths })
    return false
  }

  try {
    await spawn('git', ['commit', '-m', commitMsg], stdioIgnoreOptions)
    debugGit('commit', true)
    return true
  } catch (e) {
    debugGit('commit', false, { error: e })
    debugDir({ commitMsg })
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
    await spawn('git', ['branch', '-D', branch], stdioIgnoreOptions)
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

export async function gitEnsureIdentity(
  name: string,
  email: string,
  cwd = process.cwd(),
): Promise<void> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  const identEntries: Array<[string, string]> = [
    ['user.email', email],
    ['user.name', name],
  ]
  await Promise.all(
    identEntries.map(async ({ 0: prop, 1: value }) => {
      let configValue: unknown
      try {
        // Will throw with exit code 1 if the config property is not set.
        const gitConfigResult = await spawn(
          'git',
          ['config', '--get', prop],
          stdioPipeOptions,
        )
        configValue = gitConfigResult.stdout
      } catch (e) {
        // Expected when config property is not set.
        debugDir({
          message: `Git config property not set: ${prop}`,
          error: e,
        })
      }
      if (configValue !== value) {
        const stdioIgnoreOptions: SpawnOptions = {
          cwd,
          stdio: isDebug() ? 'inherit' : 'ignore',
        }
        try {
          await spawn('git', ['config', prop, value], stdioIgnoreOptions)
        } catch (e) {
          debug(`Failed to set git config: ${prop}`)
          debugDir(e)
          debugDir({ value })
        }
      }
    }),
  )
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

export async function gitResetAndClean(
  branch = 'HEAD',
  cwd = process.cwd(),
): Promise<void> {
  // Discards tracked changes.
  await gitResetHard(branch, cwd)
  // Deletes all untracked files and directories.
  await gitCleanFdx(cwd)
}

export async function gitResetHard(
  branch = 'HEAD',
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    await spawn('git', ['reset', '--hard', branch], stdioIgnoreOptions)
    debugGit(`reset --hard ${branch}`, true)
    return true
  } catch (e) {
    debugGit(`reset --hard ${branch}`, false, { error: e })
  }
  return false
}

export async function gitUnstagedModifiedFiles(
  cwd = process.cwd(),
): Promise<CResult<string[]>> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  try {
    const gitDiffResult = await spawn(
      'git',
      ['diff', '--name-only'],
      stdioPipeOptions,
    )
    const changedFilesDetails =
      typeof gitDiffResult.stdout === 'string'
        ? gitDiffResult.stdout
        : gitDiffResult.stdout.toString('utf8')
    const relPaths = changedFilesDetails.split('\n')
    return {
      ok: true,
      data: relPaths.map((p: string) => normalizePath(p)),
    }
  } catch (e) {
    debug('Failed to get unstaged modified files')
    debugDir(e)
    return {
      ok: false,
      message: 'Git Error',
      cause: 'Unexpected error while trying to ask git whether repo is dirty',
    }
  }
}

const parsedGitRemoteUrlCache = new Map<string, RepoInfo | undefined>()

export function parseGitRemoteUrl(remoteUrl: string): RepoInfo | undefined {
  let result = parsedGitRemoteUrlCache.get(remoteUrl)
  if (result) {
    return { ...result }
  }
  // Handle SSH-style
  const sshMatch = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
  // 1. Handle SSH-style, e.g. git@github.com:owner/repo.git
  if (sshMatch) {
    result = { owner: sshMatch[1]!, repo: sshMatch[2]! }
  } else {
    // 2. Handle HTTPS/URL-style, e.g. https://github.com/owner/repo.git
    try {
      const parsed = new URL(remoteUrl)
      // Remove leading slashes from pathname and split by "/" to extract segments.
      const segments = parsed.pathname.replace(/^\/+/, '').split('/')
      // The second-to-last segment is expected to be the owner (e.g., "owner" in /owner/repo.git).
      const owner = segments.at(-2)
      // The last segment is expected to be the repo name, so we remove the ".git" suffix if present.
      const repo = segments.at(-1)?.replace(/\.git$/, '')
      if (owner && repo) {
        result = { owner, repo }
      }
    } catch {}
  }
  parsedGitRemoteUrlCache.set(remoteUrl, result)
  return result ? { ...result } : result
}
