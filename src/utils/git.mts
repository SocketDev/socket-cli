import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { isSpawnError, spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'

import type { CResult } from '../types.mts'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

export async function getBaseBranch(cwd = process.cwd()): Promise<string> {
  // Lazily access constants.ENV properties.
  const { GITHUB_BASE_REF, GITHUB_REF_NAME, GITHUB_REF_TYPE } = constants.ENV
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
    const originDetails = (
      await spawn('git', ['remote', 'show', 'origin'], { cwd })
    ).stdout

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
): Promise<RepoInfo | null> {
  let info = null
  const quotedCmd = 'git remote get-url origin`'
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    const remoteUrl = (
      await spawn('git', ['remote', 'get-url', 'origin'], { cwd })
    ).stdout
    info = parseGitRemoteUrl(remoteUrl)
    if (!info) {
      debugFn('error', 'git: unmatched git remote URL format')
      debugDir('inspect', { remoteUrl })
    }
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return info
}

export async function getRepoName(cwd = process.cwd()): Promise<string | null> {
  const repoInfo = await getRepoInfo(cwd)
  return repoInfo?.repo ?? null
}

export async function getRepoOwner(
  cwd = process.cwd(),
): Promise<string | null> {
  const repoInfo = await getRepoInfo(cwd)
  return repoInfo?.owner ?? null
}

export async function gitBranch(cwd = process.cwd()): Promise<string | null> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  // Try symbolic-ref first which returns the branch name or fails in a
  // detached HEAD state.
  try {
    return (
      await spawn('git', ['symbolic-ref', '--short', 'HEAD'], stdioPipeOptions)
    ).stdout
  } catch {}
  // Fallback to using rev-parse to get the short commit hash in a
  // detached HEAD state.
  try {
    return (
      await spawn('git', ['rev-parse', '--short', 'HEAD'], stdioPipeOptions)
    ).stdout
  } catch {}
  return null
}

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = '`git clean -fdx`'
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['clean', '-fdx'], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return false
}

export async function gitCheckoutBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git checkout ${branch}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['checkout', branch], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
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
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git branch ${branch}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['branch', branch], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return false
}

export async function gitPushBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git push --force --set-upstream origin ${branch}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      stdioIgnoreOptions,
    )
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    if (isSpawnError(e) && e.code === 128) {
      debugFn(
        'error',
        "denied: token requires write permissions for 'contents' and 'pull-requests'",
      )
    }
    debugDir('inspect', { error: e })
  }
  return false
}

export async function gitCommit(
  commitMsg: string,
  filepaths: string[],
  options?: GitCreateAndPushBranchOptions | undefined,
): Promise<boolean> {
  if (!filepaths.length) {
    debugFn('notice', `miss: no filepaths to add`)
    return false
  }
  const {
    cwd = process.cwd(),
    // Lazily access constants.ENV.SOCKET_CLI_GIT_USER_EMAIL.
    email = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL,
    // Lazily access constants.ENV.SOCKET_CLI_GIT_USER_NAME.
    user = constants.ENV.SOCKET_CLI_GIT_USER_NAME,
  } = { __proto__: null, ...options } as GitCreateAndPushBranchOptions

  await gitEnsureIdentity(user, email, cwd)

  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedAddCmd = `\`git add ${filepaths.join(' ')}\``
  debugFn('stdio', `spawn: ${quotedAddCmd}`)
  try {
    await spawn('git', ['add', ...filepaths], stdioIgnoreOptions)
  } catch (e) {
    debugFn('error', `caught: ${quotedAddCmd} failed`)
    debugDir('inspect', { error: e })
  }

  const quotedCommitCmd = `\`git commit -m ${commitMsg}\``
  debugFn('stdio', `spawn: ${quotedCommitCmd}`)
  try {
    await spawn('git', ['commit', '-m', commitMsg], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCommitCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return false
}

export async function gitDeleteBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git branch -D ${branch}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    // Will throw with exit code 1 if branch does not exist.
    await spawn('git', ['branch', '-D', branch], stdioIgnoreOptions)
    return true
  } catch (e) {
    if (isDebug('stdio')) {
      debugFn('error', `caught: ${quotedCmd} failed`)
      debugDir('inspect', { error: e })
    }
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
    ['user.email', name],
    ['user.name', email],
  ]
  await Promise.all(
    identEntries.map(async ({ 0: prop, 1: value }) => {
      let configValue
      {
        const quotedCmd = `\`git config --get ${prop}\``
        debugFn('stdio', `spawn: ${quotedCmd}`)
        try {
          // Will throw with exit code 1 if the config property is not set.
          configValue = (
            await spawn('git', ['config', '--get', prop], stdioPipeOptions)
          ).stdout
        } catch (e) {
          if (isDebug('stdio')) {
            debugFn('error', `caught: ${quotedCmd} failed`)
            debugDir('inspect', { error: e })
          }
        }
      }
      if (configValue !== value) {
        const stdioIgnoreOptions: SpawnOptions = {
          cwd,
          stdio: isDebug('stdio') ? 'inherit' : 'ignore',
        }
        const quotedCmd = `\`git config ${prop} ${value}\``
        debugFn('stdio', `spawn: ${quotedCmd}`)
        try {
          await spawn('git', ['config', prop, value], stdioIgnoreOptions)
        } catch (e) {
          if (isDebug('stdio')) {
            debugFn('error', `caught: ${quotedCmd} failed`)
            debugDir('inspect', { error: e })
          }
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
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git show-ref --quiet refs/heads/${branch}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    // Will throw with exit code 1 if the branch does not exist.
    await spawn(
      'git',
      ['show-ref', '--quiet', `refs/heads/${branch}`],
      stdioIgnoreOptions,
    )
    return true
  } catch (e) {
    if (isDebug('stdio')) {
      debugFn('error', `caught: ${quotedCmd} failed`)
      debugDir('inspect', { error: e })
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
    return (
      (
        await spawn(
          'git',
          ['ls-remote', '--heads', 'origin', branch],
          stdioPipeOptions,
        )
      ).stdout.length > 0
    )
  } catch {}
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
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git reset --hard ${branch}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['reset', '--hard', branch], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return false
}

export async function gitUnstagedModifiedFiles(
  cwd = process.cwd(),
): Promise<CResult<string[]>> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  const quotedCmd = `\`git diff --name-only\``
  try {
    const changedFilesDetails = (
      await spawn('git', ['diff', '--name-only'], stdioPipeOptions)
    ).stdout
    const relPaths = changedFilesDetails.split('\n')
    return {
      ok: true,
      data: relPaths.map(p => normalizePath(p)),
    }
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
    return {
      ok: false,
      message: 'Git Error',
      cause: 'Unexpected error while trying to ask git whether repo is dirty',
    }
  }
}

const parsedGitRemoteUrlCache = new Map<string, RepoInfo | null>()

export function parseGitRemoteUrl(remoteUrl: string): RepoInfo | null {
  let result = parsedGitRemoteUrlCache.get(remoteUrl) ?? null
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
