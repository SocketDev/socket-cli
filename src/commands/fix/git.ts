import { PackageURL } from '@socketregistry/packageurl-js'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants'

const { GITHUB_REF_NAME } = constants

function formatBranchName(str: string): string {
  return str.replace(/[-_.]+/g, '-').replace(/[-a-zA-Z0-9]+/g, '') ?? ''
}

function getPkgNameFromPurlObj(purlObj: PackageURL): string {
  return `${purlObj.namespace ? `${purlObj.namespace}/` : ''}${purlObj.name}`
}

export async function branchExists(
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

export async function checkoutBaseBranchIfAvailable(
  baseBranch: string,
  cwd: string | undefined = process.cwd()
) {
  try {
    await spawn('git', ['checkout', baseBranch], { cwd })
    await spawn('git', ['reset', '--hard', `origin/${baseBranch}`], { cwd })
    logger.info(`Checked out and reset to ${baseBranch}`)
  } catch {
    logger.warn(`Could not switch to ${baseBranch}. Proceeding with HEAD.`)
  }
}

export async function createAndPushBranchIfNeeded(
  branch: string,
  commitMsg: string,
  cwd: string = process.cwd()
): Promise<boolean> {
  if (await branchExists(branch, cwd)) {
    logger.warn(`Branch "${branch}" already exists. Skipping creation.`)
    return false
  }
  await spawn('git', ['checkout', '-b', branch], { cwd })
  await spawn('git', ['add', 'package.json', 'pnpm-lock.yaml'], { cwd })
  await spawn('git', ['commit', '-m', commitMsg], { cwd })
  await spawn('git', ['push', '--set-upstream', 'origin', branch], { cwd })
  return true
}

export function getBaseBranch() {
  // Lazily access constants.ENV[GITHUB_REF_NAME].
  return (
    constants.ENV[GITHUB_REF_NAME] ??
    // GitHub defaults to branch name "main"
    // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches#about-the-default-branch
    'main'
  )
}

export function getSocketBranchName(purl: string, toVersion: string): string {
  const purlObj = PackageURL.fromString(purl)
  const namespace = formatBranchName(purlObj.namespace ?? '')
  const name = formatBranchName(purlObj.name)
  const version = formatBranchName(toVersion)
  const fullName = `${namespace ? `${namespace}-` : ''}${name}`
  return `socket-fix-${fullName}-${version}`
}

export function getSocketPullRequestTitle(
  purl: string,
  toVersion: string
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgName = getPkgNameFromPurlObj(purlObj)
  return `Bump ${pkgName} from ${purlObj.version} to ${toVersion}`
}

export function getSocketPullRequestBody(
  purl: string,
  toVersion: string
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgName = getPkgNameFromPurlObj(purlObj)
  return `Bumps [${pkgName}](https://socket.dev/${purlObj.type}/package/${pkgName}) from ${purlObj.version} to ${toVersion}.`
}

export function getSocketCommitMessage(
  purl: string,
  toVersion: string
): string {
  const purlObj = PackageURL.fromString(purl)
  const pkgName = getPkgNameFromPurlObj(purlObj)
  return `socket: Bump ${pkgName} from ${purlObj.version} to ${toVersion}`
}
