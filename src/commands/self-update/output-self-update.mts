/** @fileoverview Self-update output formatter for Socket CLI. Displays update progress, version information, and success/error messages during SEA binary updates. */

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

/**
 * Self-update output options.
 */
export interface SelfUpdateOutput {
  currentVersion: string
  latestVersion: string
  isUpToDate: boolean
  dryRun: boolean
  updateSucceeded?: boolean | undefined
  backupPath?: string | undefined
}

/**
 * Format and output self-update results.
 */
export async function outputSelfUpdate(
  options: SelfUpdateOutput,
): Promise<void> {
  const {
    backupPath,
    currentVersion,
    dryRun,
    isUpToDate,
    latestVersion,
    updateSucceeded,
  } = options

  if (isUpToDate) {
    logger.success(`Already up to date (${colors.cyan(currentVersion)})`)
    return
  }

  if (dryRun) {
    logger.log(
      `${colors.yellow('→')} Update available: ${colors.gray(currentVersion)} → ${colors.green(latestVersion)}`,
    )
    logger.log('Run without --dry-run to perform the update')
    return
  }

  if (updateSucceeded) {
    logger.success(
      `Successfully updated from ${colors.gray(currentVersion)} to ${colors.green(latestVersion)}`,
    )
    if (backupPath) {
      logger.log(`${colors.dim('Backup:')} ${backupPath}`)
    }
  } else {
    logger.fail(`Update failed`)
  }
}
