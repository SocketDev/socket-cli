/**
 * User-facing error messages + permission-requirements logging for
 * Socket API failures.
 *
 * Extracted from api.mts to keep that file under the 1000-line
 * File-size cap. These helpers turn opaque HTTP status codes into
 * actionable guidance ("here's where to update your token", "here's
 * how to check rate limits") and translate command paths into the
 * permission set the API was expecting.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
} from '../../constants/http.mts'
import {
  SOCKET_CLI_ISSUES_URL,
  SOCKET_PRICING_URL,
  SOCKET_SETTINGS_API_TOKENS_URL,
  SOCKET_STATUS_URL,
} from '../../constants/socket.mts'
import {
  getRequirements,
  getRequirementsKey,
} from '../ecosystem/requirements.mts'

const logger = getDefaultLogger()

export type CommandRequirements = {
  permissions?: string[] | undefined
  quota?: number | undefined
}

/**
 * Get command requirements from requirements.json based on command path.
 */
export function getCommandRequirements(
  cmdPath?: string | undefined,
): CommandRequirements | undefined {
  if (!cmdPath) {
    return undefined
  }

  const requirements = getRequirements()
  const key = getRequirementsKey(cmdPath)
  return (requirements.api as any)[key] || undefined
}

/**
 * Log required permissions for a command when encountering 403 errors with actionable guidance.
 *
 * @param cmdPath - Command path to look up requirements for (e.g., "socket fix", "socket scan:create")
 */
export function logPermissionsFor403(cmdPath?: string | undefined): void {
  const requirements = getCommandRequirements(cmdPath)

  logger.error('')
  if (requirements?.permissions?.length) {
    logger.group('🔐 Required API Permissions:')
    for (const permission of requirements.permissions) {
      logger.error(permission)
    }
    logger.groupEnd()
    logger.error('')
    logger.group('💡 To fix this:')
    logger.error(`Visit ${SOCKET_SETTINGS_API_TOKENS_URL}`)
    logger.error('Edit your API token to grant the permissions listed above')
    logger.error('Re-run your command')
    logger.groupEnd()
  } else {
    // No specific permissions found, provide general guidance.
    logger.group('🔐 Permission Requirements:')
    logger.error(
      'Your API token lacks the required permissions for this operation.',
    )
    logger.groupEnd()
    logger.error('')
    logger.group('💡 To fix this:')
    logger.error(`Visit ${SOCKET_SETTINGS_API_TOKENS_URL}`)
    logger.error('Check your API token has the necessary permissions')
    logger.error(
      `Run \`socket ${cmdPath?.replace(/^socket[: ]/, '') || 'help'} --help\` to see required permissions`,
    )
    logger.error('Re-run your command after updating permissions')
    logger.groupEnd()
  }
  logger.error('')
}

/**
 * Get user-friendly error message for HTTP status codes with actionable guidance.
 */
export async function getErrorMessageForHttpStatusCode(code: number) {
  if (code === HTTP_STATUS_BAD_REQUEST) {
    return (
      '❌ Invalid request: One of the options or parameters may be incorrect.\n' +
      '💡 Try: Check your command syntax and parameter values.'
    )
  }
  if (code === HTTP_STATUS_UNAUTHORIZED) {
    return (
      '❌ Authentication failed: Your Socket API token appears to be invalid, expired, or revoked.\n' +
      '💡 Try:\n' +
      '  • Run `socket whoami` to verify your current token\n' +
      '  • Run `socket login` to re-authenticate\n' +
      `  • Manage tokens at ${SOCKET_SETTINGS_API_TOKENS_URL}`
    )
  }
  if (code === HTTP_STATUS_FORBIDDEN) {
    return (
      '❌ Access denied: Your API token lacks required permissions or organization access.\n' +
      '💡 Try:\n' +
      '  • Run `socket whoami` to verify your account and organization\n' +
      `  • Check your API token permissions at ${SOCKET_SETTINGS_API_TOKENS_URL}\n` +
      "  • Ensure you're accessing the correct organization with `--org` flag\n" +
      `  • Verify your plan includes this feature at ${SOCKET_PRICING_URL}`
    )
  }
  if (code === HTTP_STATUS_NOT_FOUND) {
    return (
      "❌ Not found: The requested endpoint or resource doesn't exist.\n" +
      '💡 Try:\n' +
      '  • Verify resource names (package, repository, organization)\n' +
      '  • Check if the resource was deleted or moved\n' +
      '  • Update to the latest CLI version: `socket self-update` (SEA) or `npm update -g socket`\n' +
      `  • Report persistent issues at ${SOCKET_CLI_ISSUES_URL}`
    )
  }
  if (code === HTTP_STATUS_TOO_MANY_REQUESTS) {
    return (
      '❌ Rate limit exceeded: Too many API requests.\n' +
      '💡 Try:\n' +
      `  • Free plan: Wait a few minutes for quota reset or upgrade at ${SOCKET_PRICING_URL}\n` +
      '  • Paid plan: Contact support if rate limits seem incorrect\n' +
      '  • Check current quota: `socket organization quota`\n' +
      '  • Reduce request frequency or batch operations'
    )
  }
  if (code === HTTP_STATUS_INTERNAL_SERVER_ERROR) {
    return (
      '❌ Server error: Socket API encountered an internal problem (HTTP 500).\n' +
      '💡 Try:\n' +
      '  • Wait a few minutes and retry your command\n' +
      `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
      `  • Report persistent issues: ${SOCKET_CLI_ISSUES_URL}`
    )
  }
  return (
    `❌ HTTP ${code}: Server responded with unexpected status code.\n` +
    `💡 Try: Check Socket status at ${SOCKET_STATUS_URL} or report the issue.`
  )
}
