import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'

import type { CResult } from '../types.mts'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

export async function getBaseGitBranch(cwd = process.cwd()): Promise<string> {
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
  // GitHub defaults to branch name "main"
  // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches#about-the-default-branch
  return 'main'
}

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  // TODO: propagate CResult?
  await spawn('git', ['clean', '-fdx'], stdioIgnoreOptions)
}

export async function gitCheckoutBranch(
  branch: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  try {
    await spawn('git', ['checkout', branch], stdioIgnoreOptions)
    return true
  } catch {}
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
  try {
    await spawn('git', ['branch', branch], stdioIgnoreOptions)
    return true
  } catch {}
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
  try {
    await spawn(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      stdioIgnoreOptions,
    )
    return true
  } catch (e) {
    debugFn(
      'error',
      `caught: git push --force --set-upstream origin ${branch} failed`,
    )
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
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  try {
    await gitEnsureIdentity(user, email, cwd)
    await spawn('git', ['add', ...filepaths], stdioIgnoreOptions)
    await spawn('git', ['commit', '-m', commitMsg], stdioIgnoreOptions)
    return true
  } catch {}
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
  try {
    // Will throw with exit code 1 if branch does not exist.
    await spawn('git', ['branch', '-D', branch], stdioIgnoreOptions)
    return true
  } catch {}
  return false
}

export async function gitEnsureIdentity(
  name: string,
  email: string,
  cwd = process.cwd(),
): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const stdioPipeOptions: SpawnOptions = { cwd }
  const identEntries: Array<[string, string]> = [
    ['user.email', name],
    ['user.name', email],
  ]
  await Promise.all(
    identEntries.map(async ({ 0: prop, 1: value }) => {
      let configValue
      try {
        // Will throw with exit code 1 if the config property is not set.
        configValue = (
          await spawn('git', ['config', '--get', prop], stdioPipeOptions)
        ).stdout
      } catch {}
      if (configValue !== value) {
        try {
          await spawn('git', ['config', prop, value], stdioIgnoreOptions)
        } catch (e) {
          debugFn('error', `caught: git config ${prop} ${value} failed`)
          debugDir('inspect', { error: e })
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
  try {
    // Will throw with exit code 1 if the branch does not exist.
    await spawn(
      'git',
      ['show-ref', '--quiet', `refs/heads/${branch}`],
      stdioIgnoreOptions,
    )
    return true
  } catch {}
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

export type RepoInfo = {
  owner: string
  repo: string
}

export async function gitRepoInfo(
  cwd = process.cwd(),
): Promise<RepoInfo | null> {
  try {
    const remoteUrl = (
      await spawn('git', ['remote', 'get-url', 'origin'], { cwd })
    ).stdout
    // 1. Handle SSH-style, e.g. git@github.com:owner/repo.git
    const sshMatch = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
    if (sshMatch) {
      return { owner: sshMatch[1]!, repo: sshMatch[2]! }
    }
    // 2. Handle HTTPS/URL-style, e.g. https://github.com/owner/repo.git
    try {
      const parsed = new URL(remoteUrl)
      const segments = parsed.pathname.split('/')
      const owner = segments.at(-2)
      const repo = segments.at(-1)?.replace(/\.git$/, '')
      if (owner && repo) {
        return { owner, repo }
      }
    } catch {}
    debugFn('error', 'git: unmatched git remote URL format')
    debugDir('inspect', { remoteUrl })
  } catch (e) {
    debugFn('error', 'caught: `git remote get-url origin` failed')
    debugDir('inspect', { error: e })
  }
  return null
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
): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  await spawn('git', ['reset', '--hard', branch], stdioIgnoreOptions)
}

export async function gitUnstagedModifiedFiles(
  cwd = process.cwd(),
): Promise<CResult<string[]>> {
  try {
    const stdioPipeOptions: SpawnOptions = { cwd }
    const changedFilesDetails = (
      await spawn('git', ['diff', '--name-only'], stdioPipeOptions)
    ).stdout
    const relPaths = changedFilesDetails.split('\n') ?? []
    return {
      ok: true,
      data: relPaths.map(p => normalizePath(p)),
    }
  } catch (e) {
    debugFn('error', 'caught: git diff --name-only failed')
    debugDir('inspect', { error: e })
    return {
      ok: false,
      message: 'Git Error',
      cause: 'Unexpected error while trying to ask git whether repo is dirty',
    }
  }
}
