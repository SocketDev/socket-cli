import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { onExit } from '@socketsecurity/lib-stable/events/exit/handler'

import { socketPackageLink } from '../terminal/link.mts'

const logger = getDefaultLogger()

const CHANGELOG_MD = 'CHANGELOG.md'
const NPM = 'npm'

/**
 * Format an update message with appropriate commands and links.
 */
export function formatUpdateMessage(
  name: string,
  current: string,
  latest: string,
): {
  message: string
  changelog: string
} {
  const message = `Update available for ${colors.cyan(name)}: ${colors.gray(current)} → ${colors.green(latest)}`

  // npm installation - show `npm install` command
  return {
    message,
    changelog: socketPackageLink(
      NPM,
      name,
      `files/${latest}/${CHANGELOG_MD}`,
      'View changelog',
    ),
  }
}

/**
 * Schedule update notification to show on process exit. This ensures the
 * notification doesn't interfere with command output.
 */
export function scheduleExitNotification(
  name: string,
  current: string,
  latest: string,
): void {
  if (!process.stdout?.isTTY) {
    return // Probably piping stdout.
  }

  try {
    const notificationLogger = () =>
      showUpdateNotification(name, current, latest)
    onExit(notificationLogger)
  } catch (e) {
    logger.warn(`Failed to schedule exit notification: ${errorMessage(e)}`)
  }
}

/**
 * Show update notification immediately.
 */
export function showUpdateNotification(
  name: string,
  current: string,
  latest: string,
): void {
  if (!process.stdout?.isTTY) {
    return // Probably piping stdout.
  }

  try {
    const formatted = formatUpdateMessage(name, current, latest)

    logger.log('')
    logger.log('')
    logger.log(formatted.message)
    logger.log(formatted.changelog)
  } catch {
    // If formatting or logging fails, show a simpler message.

    logger.log('')
    logger.log('')
    logger.log(`Update available for ${name}: ${current} → ${latest}`)
  }
}
