import path from 'node:path'

import { PackageURL } from '@socketregistry/packageurl-js'
import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import {
  getPkgFullNameFromPurlObj,
  getSocketDevPackageOverviewUrlFromPurl
} from '../../utils/socket-url.mts'

function formatBranchName(str: string): string {
  return str
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
  workspaceName?: string | undefined
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
  workspaceName?: string | undefined
): RegExp {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName
    ? ` in ${escapeRegExp(workspaceName)}`
    : ''
  return new RegExp(
    `Bump ${escapeRegExp(pkgFullName)} from ${escapeRegExp(purlObj.version!)} to \\S+${workspaceDetails}`
  )
}

export function getSocketPullRequestTitle(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `Bump ${pkgFullName} from ${purlObj.version} to ${newVersion}${workspaceDetails}`
}

export function getSocketPullRequestBody(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `Bump [${pkgFullName}](${getSocketDevPackageOverviewUrlFromPurl(purlObj)}) from ${purlObj.version} to ${newVersion}${workspaceDetails}.`
}

export function getSocketCommitMessage(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgFullName = getPkgFullNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `socket: Bump ${pkgFullName} from ${purlObj.version} to ${newVersion}${workspaceDetails}`
}

export async function gitCreateAndPushBranchIfNeeded(
  branch: string,
  commitMsg: string,
  cwd = process.cwd()
): Promise<boolean> {
  if (await gitRemoteBranchExists(branch, cwd)) {
    logger.warn(`Branch "${branch}" already exists remotely, skipping push.`)
    return true
  }
  const moddedFilepaths = (await gitUnstagedModifiedFiles(cwd)).filter(p => {
    const basename = path.basename(p)
    return (
      basename === 'package.json' ||
      basename === 'package-lock.json' ||
      basename === 'pnpm-lock.yaml'
    )
  })
  if (!moddedFilepaths.length) {
    logger.warn('Nothing to commit, skipping push.')
    return false
  }
  await spawn('git', ['checkout', '-b', branch], { cwd })
  await spawn('git', ['add', ...moddedFilepaths], { cwd })
  await spawn('git', ['commit', '-m', commitMsg], { cwd })
  try {
    await spawn('git', ['push', '--set-upstream', 'origin', branch], { cwd })
    return true
  } catch {}
  logger.warn(`Push failed for "${branch}", trying force-push`)
  try {
    await spawn(
      'git',
      ['push', '--force', '--set-upstream', 'origin', branch],
      { cwd }
    )
    return true
  } catch {}
  logger.warn(`Force-push failed for "${branch}"`)
  return false
}

export async function gitResetAndClean(
  branch = 'HEAD',
  cwd = process.cwd()
): Promise<void> {
  // Discards tracked changes.
  await gitResetHard(branch, cwd)
  // Deletes all untracked files and directories.
  await gitCleanFdx(cwd)
}

export async function gitResetHard(
  branch = 'HEAD',
  cwd = process.cwd()
): Promise<void> {
  await spawn('git', ['reset', '--hard', branch], { cwd })
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<void> {
  await spawn('git', ['clean', '-fdx'], { cwd })
}

export async function gitRemoteBranchExists(
  branch: string,
  cwd = process.cwd()
): Promise<boolean> {
  try {
    const { stdout } = await spawn(
      'git',
      ['ls-remote', '--heads', 'origin', branch],
      { cwd }
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function gitUnstagedModifiedFiles(
  cwd = process.cwd()
): Promise<string[]> {
  const { stdout } = await spawn('git', ['diff', '--name-only'], { cwd })
  const rawFiles = stdout?.trim().split('\n') ?? []
  return rawFiles.map(relPath => normalizePath(relPath))
}
