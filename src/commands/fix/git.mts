import { PackageURL } from '@socketregistry/packageurl-js'
import { debugFn } from '@socketsecurity/registry/lib/debug'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import {
  getPkgFullNameFromPurlObj,
  getSocketDevPackageOverviewUrlFromPurl,
} from '../../utils/socket-url.mts'

import type { CResult } from '../../types.mts'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

export type GetSocketPrTitlePatternOptions = {
  purl?: string | undefined
  workspace?: string | undefined
}

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

function formatBranchName(name: string): string {
  return name
    .replace(/[-_.\\/]+/g, '-')
    .replace(/[^-a-zA-Z0-9]+/g, '')
    .replace(/^-+|-+$/g, '')
}

export function getBaseGitBranch(): string {
  // Lazily access constants.ENV.GITHUB_REF_NAME.
  return (
    constants.ENV.GITHUB_REF_NAME ||
    // GitHub defaults to branch name "main"
    // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches#about-the-default-branch
    'main'
  )
}

export function getSocketBranchName(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined,
): string {
  const purlObj = PackageURL.fromString(purl)
  const maybeWorkspaceName = workspaceName
    ? `${formatBranchName(workspaceName)}-`
    : ''
  const maybeNamespace = purlObj.namespace
    ? `${formatBranchName(purlObj.namespace)}-`
    : ''
  const fullName = `${maybeWorkspaceName}${maybeNamespace}${formatBranchName(purlObj.name)}`
  return `socket/${fullName}-${formatBranchName(newVersion)}`
}

export function getSocketPrTitlePattern(
  options?: GetSocketPrTitlePatternOptions | undefined,
): RegExp {
  const { purl, workspace } = {
    __proto__: null,
    ...options,
  } as GetSocketPrTitlePatternOptions
  const purlObj = purl ? PackageURL.fromString(purl) : null
  const escapedPkgFullName = purlObj
    ? escapeRegExp(getPkgFullNameFromPurlObj(purlObj))
    : '\\S+'
  const escapedPkgVersion = purlObj ? escapeRegExp(purlObj.version!) : '\\S+'
  const escapedWorkspaceDetails = workspace
    ? ` in ${escapeRegExp(workspace)}`
    : ''
  return new RegExp(
    `Bump ${escapedPkgFullName} from ${escapedPkgVersion} to \\S+${escapedWorkspaceDetails}`,
  )
}

export function getSocketPullRequestTitle(
  purl: string,
  toVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspace ? ` in ${workspace}` : ''
  return `Bump ${pkgFullName} from ${purlObj.version} to ${toVersion}${workspaceDetails}`
}

export function getSocketPullRequestBody(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined,
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `Bump [${pkgFullName}](${getSocketDevPackageOverviewUrlFromPurl(purlObj)}) from ${purlObj.version} to ${newVersion}${workspaceDetails}.`
}

export function getSocketCommitMessage(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined,
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `socket: Bump ${pkgFullName} from ${purlObj.version} to ${newVersion}${workspaceDetails}`
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
  // TODO: propagate CResult?
  await spawn('git', ['clean', '-fdx'], stdioIgnoreOptions)
}

export async function gitCreateAndPushBranch(
  branch: string,
  commitMsg: string,
  filepaths: string[],
  options?: GitCreateAndPushBranchOptions | undefined,
): Promise<boolean> {
  const {
    cwd = process.cwd(),
    // Lazily access constants.ENV.SOCKET_CLI_GIT_USER_EMAIL.
    email = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL,
    // Lazily access constants.ENV.SOCKET_CLI_GIT_USER_NAME.
    user = constants.ENV.SOCKET_CLI_GIT_USER_NAME,
  } = { __proto__: null, ...options } as GitCreateAndPushBranchOptions
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
  try {
    await gitEnsureIdentity(user, email, cwd)
    await spawn('git', ['checkout', '-b', branch], stdioIgnoreOptions)
    await spawn('git', ['add', ...filepaths], stdioIgnoreOptions)
    await spawn('git', ['commit', '-m', commitMsg], stdioIgnoreOptions)
    await spawn(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      stdioIgnoreOptions,
    )
    return true
  } catch (e) {
    debugFn('catch: unexpected\n', e)
  }
  try {
    // Will throw with exit code 1 if branch does not exist.
    await spawn('git', ['branch', '-D', branch], stdioIgnoreOptions)
  } catch {}
  return false
}

export async function gitEnsureIdentity(
  name: string,
  email: string,
  cwd = process.cwd(),
): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
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
        ).stdout.trim()
      } catch {}
      if (configValue !== value) {
        try {
          await spawn('git', ['config', prop, value], stdioIgnoreOptions)
        } catch (e) {
          debugFn('catch: unexpected\n', e)
        }
      }
    }),
  )
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
      ).stdout.trim().length > 0
    )
  } catch {
    return false
  }
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
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
  await spawn('git', ['reset', '--hard', branch], stdioIgnoreOptions)
}

export async function gitUnstagedModifiedFiles(
  cwd = process.cwd(),
): Promise<CResult<string[]>> {
  try {
    const stdioPipeOptions: SpawnOptions = { cwd }
    const stdout = (
      await spawn('git', ['diff', '--name-only'], stdioPipeOptions)
    ).stdout.trim()
    const rawFiles = stdout.split('\n') ?? []
    return { ok: true, data: rawFiles.map(relPath => normalizePath(relPath)) }
  } catch (e) {
    debugFn('catch: git diff --name-only failed\n', e)

    return {
      ok: false,
      message: 'Git Error',
      cause: 'Unexpected error while trying to ask git whether repo is dirty',
    }
  }
}
