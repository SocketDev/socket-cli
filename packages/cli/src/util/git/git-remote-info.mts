/**
 * Remote-repository information for Socket CLI's git utilities: current
 * branch/commit detection, remote-URL parsing, and working-tree status.
 *
 * Extracted from operations.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOCKET_DEFAULT_REPOSITORY } from '../../constants/socket.mts'
import { extractName, extractOwner } from '../sanitize-names.mts'
import { getGitPath } from './git-path.mts'

import type { CResult } from '../../types.mjs'
import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

export type RepoInfo = {
  owner: string
  repo: string
}

const parsedGitRemoteUrlCache = new Map<string, RepoInfo | undefined>()

export async function getRepoInfo(
  cwd = process.cwd(),
): Promise<RepoInfo | undefined> {
  let info: RepoInfo | undefined
  try {
    const gitBin = await getGitPath()
    const result = await spawn(gitBin, ['remote', 'get-url', 'origin'], {
      cwd,
    })

    if (!result) {
      return undefined
    }

    const remoteUrl = result.stdout
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
    return gitSymbolicRefResult.stdout as string
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
    return gitRevParseResult.stdout as string
  } catch (e) {
    // Both methods failed, likely not in a git repo.
    debugDir({ message: 'Unable to determine git branch', error: e })
  }
  return undefined
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
    const changedFilesDetails = gitDiffResult.stdout as string
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
