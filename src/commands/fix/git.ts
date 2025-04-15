import path from 'node:path'

import { PackageURL } from '@socketregistry/packageurl-js'
import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants'

const { GITHUB_REF_NAME } = constants

function formatBranchName(str: string): string {
  return str.replace(/[-_.]+/g, '-').replace(/[^-a-zA-Z0-9]+/g, '') ?? ''
}

function getPkgNameFromPurlObj(purlObj: PackageURL): string {
  return `${purlObj.namespace ? `${purlObj.namespace}/` : ''}${purlObj.name}`
}

export function getBaseGitBranch() {
  // Lazily access constants.ENV[GITHUB_REF_NAME].
  return (
    constants.ENV[GITHUB_REF_NAME] ??
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
  return `socket-fix-${fullName}-${formatBranchName(newVersion)}`
}

export function getSocketPullRequestTitle(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgName = getPkgNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `Bump ${pkgName} from ${purlObj.version} to ${newVersion}${workspaceDetails}`
}

export function getSocketPullRequestBody(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgName = getPkgNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `Bumps [${pkgName}](https://socket.dev/${purlObj.type}/package/${pkgName}) from ${purlObj.version} to ${newVersion}${workspaceDetails}.`
}

export function getSocketCommitMessage(
  purl: string,
  newVersion: string,
  workspaceName?: string | undefined
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgName = getPkgNameFromPurlObj(purlObj)
  const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
  return `socket: Bump ${pkgName} from ${purlObj.version} to ${newVersion}${workspaceDetails}`
}

export async function gitBranchExists(
  branch: string,
  cwd: string | undefined = process.cwd()
): Promise<boolean> {
  try {
    await spawn(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      {
        cwd,
        stdio: 'ignore'
      }
    )
    return true
  } catch {}
  return false
}

export async function gitCheckoutBaseBranchIfAvailable(
  baseBranch: string,
  cwd = process.cwd()
) {
  try {
    await gitHardReset()
    await spawn('git', ['fetch', '--depth=1', 'origin', baseBranch], { cwd })
    await spawn('git', ['checkout', baseBranch], { cwd })
    await spawn('git', ['reset', '--hard', `origin/${baseBranch}`], { cwd })
    logger.info(`Checked out and reset to ${baseBranch}`)
  } catch (e) {
    logger.warn(`Could not switch to ${baseBranch}. Proceeding with HEAD.`)
    debugLog(e)
  }
}

export async function gitCreateAndPushBranchIfNeeded(
  branch: string,
  commitMsg: string,
  cwd = process.cwd()
): Promise<boolean> {
  if (await gitBranchExists(branch, cwd)) {
    logger.warn(`Branch "${branch}" already exists. Skipping creation.`)
    return false
  }
  await spawn('git', ['checkout', '-b', branch], { cwd })
  const moddedFilepaths = (await gitUnstagedModifiedFiles(cwd)).filter(p => {
    const basename = path.basename(p)
    return (
      basename === 'package.json' ||
      basename === 'package-lock.json' ||
      basename === 'pnpm-lock.yaml'
    )
  })
  debugLog('branch', branch)
  debugLog('gitCreateAndPushBranchIfNeeded > moddedFilepaths', moddedFilepaths)
  if (moddedFilepaths.length) {
    await spawn('git', ['add', ...moddedFilepaths], { cwd })
  }
  await spawn('git', ['commit', '-m', commitMsg], { cwd })
  await spawn('git', ['push', '--set-upstream', 'origin', branch], { cwd })
  return true
}

export async function gitHardReset(cwd = process.cwd()): Promise<void> {
  await spawn('git', ['reset', '--hard'], { cwd })
}

async function gitUnstagedModifiedFiles(
  cwd = process.cwd()
): Promise<string[]> {
  const { stdout } = await spawn('git', ['diff', '--name-only'], { cwd })
  const rawFiles = stdout?.trim().split('\n') ?? []
  return rawFiles.map(relPath => normalizePath(relPath))
}

export async function isInGitRepo(cwd = process.cwd()): Promise<boolean> {
  try {
    await spawn('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: 'ignore'
    })
    return true
  } catch {}
  return false
}
