/**
 * SOCKET_OAUTH_ISSUER environment variable.
 *
 * Issuer URL the `socket mcp` HTTP server uses to validate inbound OAuth
 * tokens. Empty string when unset.
 *
 * Read lazily so tests that mutate process.env after module load see the
 * latest value.
 */

import process from 'node:process'

export function getSocketOauthIssuer(): string {
  return process.env['SOCKET_OAUTH_ISSUER'] ?? ''
}
