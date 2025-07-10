import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getPurlObject } from '../../utils/purl.mts'
import {
  getPkgFullNameFromPurl,
  getSocketDevPackageOverviewUrlFromPurl,
} from '../../utils/socket-url.mts'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

function formatBranchName(name: string): string {
  return name.replace(/[^-a-zA-Z0-9/._-]+/g, '+')
}

export type SocketBranchParser = (
  branch: string,
) => SocketBranchParseResult | null

export type SocketBranchParseResult = {
  fullName: string
  newVersion: string
  type: string
  workspace: string
  version: string
}

export type SocketBranchPatternOptions = {
  newVersion?: string | undefined
  purl?: string | undefined
  workspace?: string | undefined
}

export function createSocketBranchParser(
  options?: SocketBranchPatternOptions | undefined,
): SocketBranchParser {
  const pattern = getSocketBranchPattern(options)
  return function parse(branch: string): SocketBranchParseResult | null {
    const match = pattern.exec(branch) as
      | [string, string, string, string, string, string]
      | null
    if (!match) {
      return null
    }
    const {
      1: type,
      2: workspace,
      3: fullName,
      4: version,
      5: newVersion,
    } = match
    return {
      fullName,
      newVersion: semver.coerce(newVersion.replaceAll('+', '.'))?.version,
      type,
      workspace,
      version: semver.coerce(version.replaceAll('+', '.'))?.version,
    } as SocketBranchParseResult
  }
}

export const genericSocketBranchParser = createSocketBranchParser()

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

export function getSocketBranchFullNameComponent(
  pkgName: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(
    typeof pkgName === 'string' && !pkgName.startsWith('pkg:')
      ? PackageURL.fromString(`pkg:unknown/${pkgName}`)
      : pkgName,
  )
  const branchMaybeNamespace = purlObj.namespace
    ? `${formatBranchName(purlObj.namespace)}--`
    : ''
  return `${branchMaybeNamespace}${formatBranchName(purlObj.name)}`
}

export function getSocketBranchName(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const branchType = getSocketBranchPurlTypeComponent(purlObj)
  const branchWorkspace = getSocketBranchWorkspaceComponent(workspace)
  const branchFullName = getSocketBranchFullNameComponent(purlObj)
  const branchVersion = getSocketBranchPackageVersionComponent(purlObj.version!)
  const branchNewVersion = formatBranchName(newVersion)
  return `socket/${branchType}/${branchWorkspace}/${branchFullName}_${branchVersion}_${branchNewVersion}`
}

export function getSocketBranchPackageVersionComponent(
  version: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(
    typeof version === 'string' && !version.startsWith('pkg:')
      ? PackageURL.fromString(`pkg:unknown/unknown@${version}`)
      : version,
  )
  return formatBranchName(purlObj.version!)
}

export function getSocketBranchPattern(
  options?: SocketBranchPatternOptions | undefined,
): RegExp {
  const { newVersion, purl, workspace } = {
    __proto__: null,
    ...options,
  } as SocketBranchPatternOptions
  const purlObj = purl ? getPurlObject(purl) : null
  const escType = purlObj ? escapeRegExp(purlObj.type) : '[^/]+'
  const escWorkspace = workspace
    ? `${escapeRegExp(formatBranchName(workspace))}`
    : '.+'
  const escMaybeNamespace = purlObj?.namespace
    ? `${escapeRegExp(formatBranchName(purlObj.namespace))}--`
    : ''
  const escFullName = purlObj
    ? `${escMaybeNamespace}${escapeRegExp(formatBranchName(purlObj.name))}`
    : '[^/_]+'
  const escVersion = purlObj
    ? escapeRegExp(formatBranchName(purlObj.version!))
    : '[^_]+'
  const escNewVersion = newVersion
    ? escapeRegExp(formatBranchName(newVersion))
    : '[^_]+'
  return new RegExp(
    `^socket/(${escType})/(${escWorkspace})/(${escFullName})_(${escVersion})_(${escNewVersion})$`,
  )
}

export function getSocketBranchPurlTypeComponent(
  purl: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(purl)
  return formatBranchName(purlObj.type)
}

export function getSocketBranchWorkspaceComponent(
  workspace: string | undefined,
): string {
  return workspace ? formatBranchName(workspace) : 'root'
}

export function getSocketCommitMessage(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  return `socket: Bump ${fullName} from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}`
}

export function getSocketPullRequestBody(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  const pkgOverviewUrl = getSocketDevPackageOverviewUrlFromPurl(purlObj)
  return `Bump [${fullName}](${pkgOverviewUrl}) from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}.`
}

export function getSocketPullRequestTitle(
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  return `Bump ${fullName} from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}`
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

export async function gitCreateAndPushBranch(
  branch: string,
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
    debugFn(
      'error',
      `caught: git push --force --set-upstream origin ${branch} failed`,
    )
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
  try {
    // Will throw with exit code 1 if branch does not exist.
    await spawn('git', ['branch', '-D', branch], stdioIgnoreOptions)
    return true
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
