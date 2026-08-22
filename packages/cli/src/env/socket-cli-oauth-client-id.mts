/**
 * SOCKET_CLI_OAUTH_CLIENT_ID environment variable.
 *
 * Overrides the OAuth client_id `socket login --device` identifies itself
 * with. Empty string when unset (falls back to the built-in
 * SOCKET_CLI_OAUTH_CLIENT_ID default, the public client registered for the
 * Socket CLI).
 */

import process from 'node:process'

export function getSocketCliOauthClientIdOverride(): string {
  return process.env['SOCKET_CLI_OAUTH_CLIENT_ID'] ?? ''
}
