/**
 * SOCKET_OAUTH_REQUIRED_SCOPES environment variable.
 *
 * Whitespace-separated list of OAuth scopes the `socket mcp` HTTP server
 * requires on every inbound token. Empty string when unset (no scope check).
 *
 * Read lazily so tests that mutate process.env after module load see the
 * latest value.
 */

import process from 'node:process'

export function getSocketOauthRequiredScopes(): string {
  return process.env['SOCKET_OAUTH_REQUIRED_SCOPES'] ?? ''
}
