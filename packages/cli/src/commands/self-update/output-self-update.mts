/**
 * Output formatting for self-update command.
 */

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

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
    backupPath,
    currentVersion,
    dryRun,
    isUpToDate,
    latestVersion,
    updateSucceeded,
  } = options

  if (isUpToDate) {
    getDefaultLogger().success(
      `Already up to date (${colors.cyan(currentVersion)})`,
    )
    return
  }

  if (dryRun) {
    getDefaultLogger().log(
      `${colors.yellow('→')} Update available: ${colors.gray(currentVersion)} → ${colors.green(latestVersion)}`,
    )
    getDefaultLogger().log('Run without --dry-run to perform the update')
    return
  }

  if (updateSucceeded) {
    getDefaultLogger().success(
      `Successfully updated from ${colors.gray(currentVersion)} to ${colors.green(latestVersion)}`,
    )
    if (backupPath) {
      getDefaultLogger().log(`${colors.dim('Backup:')} ${backupPath}`)
    }
  } else {
    getDefaultLogger().fail('Update failed')
  }
}
