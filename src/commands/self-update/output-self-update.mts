/**
 * Output formatting for self-update command.
 */

import { logger } from '@socketsecurity/registry/lib/logger'
import colors from 'yoctocolors-cjs'

/**
 * Self-update output options.
 */
export interface SelfUpdateOutput {
  currentVersion: string
  latestVersion: string
  isUpToDate: boolean
  dryRun: boolean
  updateSucceeded?: boolean
  backupPath?: string
}

/**
 * Format and output self-update results.
 */
export async function outputSelfUpdate(
  options: SelfUpdateOutput,
): Promise<void> {
  const {
    currentVersion,
    latestVersion,
    isUpToDate,
    dryRun,
    updateSucceeded,
    backupPath,
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
