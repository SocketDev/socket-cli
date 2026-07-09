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
  if (!branchName) {
    if (sockJson.defaults?.scan?.create?.branch) {
      branchName = sockJson.defaults.scan.create.branch
      logger.info(`Using default --branch from ${SOCKET_JSON}:`, branchName)
    } else {
      branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
    }
  }
  if (!repoName) {
    if (sockJson.defaults?.scan?.create?.repo) {
      repoName = sockJson.defaults.scan.create.repo
      logger.info(`Using default --repo from ${SOCKET_JSON}:`, repoName)
    } else {
      repoName = await getRepoName(cwd)
    }
  }
  if (!workspace && sockJson.defaults?.scan?.create?.workspace) {
    workspace = sockJson.defaults.scan.create.workspace
    logger.info(`Using default --workspace from ${SOCKET_JSON}:`, workspace)
  }
  if (typeof report !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.report !== undefined) {
      report = sockJson.defaults.scan.create.report
      logger.info(`Using default --report from ${SOCKET_JSON}:`, report)
    } else {
      report = false
    }
  }

  return { autoManifest, branchName, repoName, report, workspace }
}
