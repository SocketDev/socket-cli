/**
 * SOCKET_CLI_OAUTH_BASE_URL environment variable.
 *
 * Overrides the Socket API v1 OAuth base URL `socket login --device` sends
 * device-authorization and token requests to. Empty string when unset (falls
 * back to the built-in API_V1_OAUTH_URL default).
 */

import process from 'node:process'

export function getSocketCliOauthBaseUrl(): string {
  return process.env['SOCKET_CLI_OAUTH_BASE_URL'] ?? ''
}
