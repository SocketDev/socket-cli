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

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { onExit } from '@socketsecurity/lib/signal-exit'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import { SEA_UPDATE_COMMAND } from '../../constants/cli.mts'
import { getSeaBinaryPath } from '../sea/detect.mts'
import { githubRepoLink, socketPackageLink } from '../terminal/link.mts'

const CHANGELOG_MD = 'CHANGELOG.md'
const NPM = 'npm'
const SOCKET_CLI_GITHUB_REPO = 'socket-cli'
const SOCKET_GITHUB_ORG = 'SocketDev'

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
        SOCKET_GITHUB_ORG,
        SOCKET_CLI_GITHUB_REPO,
        `blob/${latest}/${CHANGELOG_MD}`,
        'View changelog',
      ),
    }
  }
  // npm installation - show npm install command
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
 * Show update notification immediately.
 */
function showUpdateNotification(options: UpdateNotificationOptions): void {
  if (!globalThis.process?.stdout?.isTTY) {
    return // Probably piping stdout.
  }

  try {
    const formatted = formatUpdateMessage(options)
    const logger = getDefaultLogger()

    logger.log(`\n\n${formatted.message}`)
    if (formatted.command) {
      logger.log(formatted.command)
    }
    logger.log(`📝 ${formatted.changelog}`)
  } catch (error) {
    // If formatting or logging fails, show a simpler message.
    const logger = getDefaultLogger()
    const { current, latest, name } = options
    const seaBinPath = getSeaBinaryPath()

    logger.log(`\n\n📦 Update available for ${name}: ${current} → ${latest}`)
    if (isNonEmptyString(seaBinPath)) {
      logger.log(
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
    getDefaultLogger().warn(
      `Failed to schedule exit notification: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export { formatUpdateMessage, scheduleExitNotification, showUpdateNotification }
