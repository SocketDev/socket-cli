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

  const defaults = sockJson.defaults?.scan?.create ?? {}

  // Note: This needs meow booleanDefault=undefined.
  if (typeof autoManifest !== 'boolean') {
    if (defaults.autoManifest !== undefined) {
      autoManifest = defaults.autoManifest
      logger.info(
        `Using default --auto-manifest from ${SOCKET_JSON}:`,
        autoManifest,
      )
    } else {
      autoManifest = false
    }
  }
  if (!branchName) {
    if (defaults.branch) {
      branchName = defaults.branch
      logger.info(`Using default --branch from ${SOCKET_JSON}:`, branchName)
    } else {
      branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
    }
  }
  if (!repoName) {
    if (defaults.repo) {
      repoName = defaults.repo
      logger.info(`Using default --repo from ${SOCKET_JSON}:`, repoName)
    } else {
      repoName = await getRepoName(cwd)
    }
  }
  if (!workspace && defaults.workspace) {
    workspace = defaults.workspace
    logger.info(`Using default --workspace from ${SOCKET_JSON}:`, workspace)
  }
  report = applyReportDefault()

  function applyReportDefault(): boolean {
    if (typeof report !== 'boolean') {
      if (defaults.report !== undefined) {
        report = defaults.report
        logger.info(`Using default --report from ${SOCKET_JSON}:`, report)
      } else {
        report = false
      }
    }
    return report
  }

  return { autoManifest, branchName, repoName, report, workspace }
}
