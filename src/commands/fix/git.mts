import { PackageURL } from '@socketregistry/packageurl-js'
import { debugFn } from '@socketsecurity/registry/lib/debug'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getPurlObject } from '../../utils/purl.mts'
import {
  getPkgFullNameFromPurlObj,
  getSocketDevPackageOverviewUrlFromPurl,
} from '../../utils/socket-url.mts'

import type { CResult } from '../../types.mts'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

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
  purl: string | PackageURL,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fmtType = formatBranchName(purlObj.type)
  const fmtWorkspace = workspace ? `${formatBranchName(workspace)}` : 'root'
  const fmtMaybeNamespace = purlObj.namespace
    ? `${formatBranchName(purlObj.namespace)}--`
    : ''
  const fmtFullName = `${fmtMaybeNamespace}${formatBranchName(purlObj.name)}`
  const fmtVersion = formatBranchName(purlObj.version!)
  const fmtNewVersion = formatBranchName(newVersion)
  return `socket/${fmtType}_${fmtWorkspace}_${fmtFullName}_${fmtVersion}_${fmtNewVersion}`
}

export type SocketBranchPatternOptions = {
  newVersion?: string | undefined
  purl?: string | undefined
  workspace?: string | undefined
}

export function getSocketBranchPattern(
  options?: SocketBranchPatternOptions | undefined,
): RegExp {
  const { newVersion, purl, workspace } = {
    __proto__: null,
    ...options,
  } as SocketBranchPatternOptions
  const purlObj = purl ? getPurlObject(purl) : null
  const escType = purlObj ? escapeRegExp(purlObj.type) : '[^_]+'
  const escWorkspace = workspace
    ? `${escapeRegExp(formatBranchName(workspace))}`
    : 'root'
  const escMaybeNamespace = purlObj?.namespace
    ? `${escapeRegExp(formatBranchName(purlObj.namespace))}--`
    : ''
  const escFullName = purlObj
    ? `${escMaybeNamespace}${escapeRegExp(formatBranchName(purlObj.name))}`
    : '[^_]+'
  const escVersion = purlObj
    ? escapeRegExp(formatBranchName(purlObj.version!))
    : '[^_]+'
  const escNewVersion = newVersion
    ? escapeRegExp(formatBranchName(newVersion))
    : '[^_]+'
  return new RegExp(
    `^socket/(${escType})_(${escWorkspace})_(${escFullName})_(${escVersion})_(${escNewVersion})$`,
  )
}

export type SocketBranchParser = (
  branch: string,
) => SocketBranchParseResult | null

export type SocketBranchParseResult = {
  newVersion: string
  purl: PackageURL
  workspace: string
}

export function createSocketBranchParser(
  options?: SocketBranchPatternOptions | undefined,
): SocketBranchParser {
  const pattern = getSocketBranchPattern(options)
  return function parse(branch: string): SocketBranchParseResult | null {
    debugFn('pattern', pattern.toString())
    const match = pattern.exec(branch)
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
      newVersion,
      purl: getPurlObject(`pkg:${type}/${fullName}@${version}`),
      workspace,
    } as SocketBranchParseResult
  }
}

export function getSocketPullRequestTitle(
  purl: string | PackageURL,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurlObj(purlObj)
  return `Bump ${fullName} from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}`
}

export function getSocketPullRequestBody(
  purl: string | PackageURL,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurlObj(purlObj)
  const pkgOverviewUrl = getSocketDevPackageOverviewUrlFromPurl(purlObj)
  return `Bump [${fullName}](${pkgOverviewUrl}) from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}.`
}

export function getSocketCommitMessage(
  purl: string | PackageURL,
  newVersion: string,
  workspace?: string | undefined,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurlObj(purlObj)
  return `socket: Bump ${fullName} from ${purlObj.version} to ${newVersion}${workspace ? ` in ${workspace}` : ''}`
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
