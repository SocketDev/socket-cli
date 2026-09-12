import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOCKET_JSON } from '../../constants.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../util/git/operations.mts'

import type { SocketJson } from '../../util/socket/json.mts'

const logger = getDefaultLogger()

export interface ScanCreateDefaultsInput {
  autoManifest: boolean | undefined
  branchName: string
  repoName: string
  report: boolean | undefined
  workspace: string
}

export interface ScanCreateDefaultsResult {
  autoManifest: boolean
  branchName: string
  repoName: string
  report: boolean
  workspace: string
}

/**
 * Fill in unset `socket scan create` flags from the project's socket.json
 * defaults (falling back to git detection for branch/repo).
 */
export async function applyScanCreateDefaults(
  cwd: string,
  sockJson: SocketJson,
  flags: ScanCreateDefaultsInput,
): Promise<ScanCreateDefaultsResult> {
  let { autoManifest, branchName, repoName, report, workspace } = flags

  autoManifest = resolveScanAutoManifest(sockJson, { autoManifest })
  branchName = await resolveScanBranchName(cwd, sockJson, branchName)
  repoName = await resolveScanRepoName(cwd, sockJson, repoName)
  workspace = resolveScanWorkspace(sockJson, workspace)
  report = resolveScanReport(sockJson, { report })
  return { autoManifest, branchName, repoName, report, workspace }
}

export function resolveScanAutoManifest(
  sockJson: SocketJson,
  options?: { autoManifest?: boolean | undefined } | undefined,
): boolean {
  let { autoManifest } = options ?? {}
  // Note: This needs meow booleanDefault=undefined.
  if (typeof autoManifest !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.autoManifest !== undefined) {
      autoManifest = sockJson.defaults.scan.create.autoManifest
      logger.info(
        `Using default --auto-manifest from ${SOCKET_JSON}:`,
        autoManifest,
      )
    } else {
      autoManifest = false
    }
  }

  return autoManifest
}

export async function resolveScanBranchName(
  cwd: string,
  sockJson: SocketJson,
  branchName: string,
): Promise<string> {
  if (!branchName) {
    if (sockJson.defaults?.scan?.create?.branch) {
      branchName = sockJson.defaults.scan.create.branch
      logger.info(`Using default --branch from ${SOCKET_JSON}:`, branchName)
    } else {
      branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
    }
  }

  return branchName
}

export async function resolveScanRepoName(
  cwd: string,
  sockJson: SocketJson,
  repoName: string,
): Promise<string> {
  if (!repoName) {
    if (sockJson.defaults?.scan?.create?.repo) {
      repoName = sockJson.defaults.scan.create.repo
      logger.info(`Using default --repo from ${SOCKET_JSON}:`, repoName)
    } else {
      repoName = await getRepoName(cwd)
    }
  }

  return repoName
}

export function resolveScanReport(
  sockJson: SocketJson,
  options?: { report?: boolean | undefined } | undefined,
): boolean {
  let { report } = options ?? {}
  if (typeof report !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.report !== undefined) {
      report = sockJson.defaults.scan.create.report
      logger.info(`Using default --report from ${SOCKET_JSON}:`, report)
    } else {
      report = false
    }
  }

  return report
}

export function resolveScanWorkspace(
  sockJson: SocketJson,
  workspace: string,
): string {
  if (!workspace && sockJson.defaults?.scan?.create?.workspace) {
    workspace = sockJson.defaults.scan.create.workspace
    logger.info(`Using default --workspace from ${SOCKET_JSON}:`, workspace)
  }

  return workspace
}
