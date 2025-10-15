/**
 * Update notification utilities for Socket CLI.
 * Handles displaying update notifications to users with appropriate messaging
 * for both SEA binaries and npm installations.
 *
 * Key Functions:
 * - showUpdateNotification: Display update available message
 * - scheduleExitNotification: Show notification when process exits
 * - formatUpdateMessage: Create user-friendly update messages
 *
 * Features:
 * - SEA vs npm aware messaging
 * - Terminal link generation for changelogs
 * - Process exit notifications
 * - Graceful fallbacks for non-TTY environments
 *
 * Usage:
 * - CLI update notifications
 * - Integration with update checker
 * - User experience messaging
 */

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { onExit } from '@socketsecurity/registry/lib/signal-exit'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import constants, { SEA_UPDATE_COMMAND } from '../../constants.mts'
import { getSeaBinaryPath } from '../executable/detect.mts'
import { githubRepoLink, socketPackageLink } from '../terminal/link.mts'

export interface UpdateNotificationOptions {
  name: string
  current: string
  latest: string
}

/**
 * Format an update message with appropriate commands and links.
 */
function formatUpdateMessage(options: UpdateNotificationOptions): {
  message: string
  command?: string
  changelog: string
} {
  const { current, latest, name } = options
  const seaBinPath = getSeaBinaryPath()

  const message = `📦 Update available for ${colors.cyan(name)}: ${colors.gray(current)} → ${colors.green(latest)}`

  if (isNonEmptyString(seaBinPath)) {
    // SEA binary - show self-update command
    return {
      message,
      command: `🔄 Run ${colors.cyan(`${seaBinPath} ${SEA_UPDATE_COMMAND}`)} to update automatically`,
      changelog: githubRepoLink(
        constants.SOCKET_GITHUB_ORG,
        constants.SOCKET_CLI_GITHUB_REPO,
        `blob/${latest}/${constants.CHANGELOG_MD}`,
        'View changelog',
      ),
    }
  } else {
    // npm installation - show npm install command
    return {
      message,
      changelog: socketPackageLink(
        constants.NPM,
        name,
        `files/${latest}/${constants.CHANGELOG_MD}`,
        'View changelog',
      ),
    }
  }
}

/**
 * Show update notification immediately.
 */
function showUpdateNotification(options: UpdateNotificationOptions): void {
  if (!globalThis.process?.stdout?.isTTY) {
    return // Probably piping stdout.
  }

  try {
    const formatted = formatUpdateMessage(options)

    logger.log(`\n\n${formatted.message}`)
    if (formatted.command) {
      logger.log(formatted.command)
    }
    logger.log(`📝 ${formatted.changelog}`)
  } catch (error) {
    // Fallback to console.log if logger fails.
    const { current, latest, name } = options
    const seaBinPath = getSeaBinaryPath()

    console.log(`\n\n📦 Update available for ${name}: ${current} → ${latest}`)
    if (isNonEmptyString(seaBinPath)) {
      console.log(
        `Run '${seaBinPath} ${SEA_UPDATE_COMMAND}' to update automatically`,
      )
    }
  }
}

/**
 * Schedule update notification to show on process exit.
 * This ensures the notification doesn't interfere with command output.
 */
function scheduleExitNotification(options: UpdateNotificationOptions): void {
  if (!globalThis.process?.stdout?.isTTY) {
    return // Probably piping stdout.
  }

  try {
    const notificationLogger = () => showUpdateNotification(options)
    onExit(notificationLogger)
  } catch (error) {
    logger.warn(
      `Failed to schedule exit notification: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export { formatUpdateMessage, scheduleExitNotification, showUpdateNotification }
