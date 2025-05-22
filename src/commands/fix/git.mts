import { PackageURL } from '@socketregistry/packageurl-js'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import {
  getPkgFullNameFromPurlObj,
  getSocketDevPackageOverviewUrlFromPurl,
} from '../../utils/socket-url.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

const GITHUB_ACTIONS_BOT_USERNAME = 'github-actions[bot]'
const GITHUB_ACTIONS_BOT_EMAIL = `${GITHUB_ACTIONS_BOT_USERNAME}@users.noreply.github.com`

function formatBranchName(name: string): string {
  return name
    .replace(/[-_.\\/]+/g, '-')
    .replace(/[^-a-zA-Z0-9]+/g, '')
    .replace(/^-+|-+$/g, '')
}

export function getBaseGitBranch() {
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
  purl: string,
  workspaceName?: string | undefined,
): RegExp {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName
    ? ` in ${escapeRegExp(workspaceName)}`
    : ''
  return new RegExp(
    `Bump ${escapeRegExp(pkgFullName)} from ${escapeRegExp(purlObj.version!)} to \\S+${workspaceDetails}`,
  )
}

export function getSocketPullRequestTitle(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined,
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `Bump ${pkgFullName} from ${purlObj.version} to ${newVersion}${workspaceDetails}`
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
  await spawn('git', ['clean', '-fdx'], stdioIgnoreOptions)
}

export async function gitCreateAndPushBranch(
  branch: string,
  commitMsg: string,
  filepaths: string[],
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
  try {
    await gitEnsureIdentity(cwd)
    await spawn('git', ['checkout', '-b', branch], stdioIgnoreOptions)
    await spawn('git', ['add', ...filepaths], stdioIgnoreOptions)
    await spawn('git', ['commit', '-m', commitMsg], stdioIgnoreOptions)
    await spawn(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      stdioIgnoreOptions,
    )
    return true
  } catch {}
  try {
    await spawn('git', ['branch', '-D', branch], stdioIgnoreOptions)
  } catch {}
  return false
}

export async function gitEnsureIdentity(cwd = process.cwd()): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
  const stdioPipeOptions: SpawnOptions = { cwd }
  let hasUserName = false
  try {
    hasUserName = !!(
      await spawn('git', ['config', '--get', 'user.name'], stdioPipeOptions)
    ).stdout.trim()
  } catch {}
  if (!hasUserName) {
    await spawn(
      'git',
      ['config', 'user.name', GITHUB_ACTIONS_BOT_USERNAME],
      stdioIgnoreOptions,
    )
  }
  let hasUserEmail = false
  try {
    hasUserEmail = !!(
      await spawn('git', ['config', '--get', 'user.email'], stdioPipeOptions)
    ).stdout.trim()
  } catch {}
  if (!hasUserEmail) {
    await spawn(
      'git',
      ['config', 'user.email', GITHUB_ACTIONS_BOT_EMAIL],
      stdioIgnoreOptions,
    )
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

export async function gitUnstagedModifiedFiles(
  cwd = process.cwd(),
): Promise<string[]> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  const stdout = (
    await spawn('git', ['diff', '--name-only'], stdioPipeOptions)
  ).stdout.trim()
  const rawFiles = stdout.split('\n') ?? []
  return rawFiles.map(relPath => normalizePath(relPath))
}
