/**
 * SOCKET_OAUTH_INTROSPECTION_CLIENT_ID environment variable.
 *
 * Client ID used by the `socket mcp` HTTP server when calling the OAuth
 * introspection endpoint. Empty string when unset.
 *
 * Read lazily so tests that mutate process.env after module load see the
 * latest value.
 */

import process from 'node:process'

export function getSocketOauthIntrospectionClientId(): string {
  return process.env['SOCKET_OAUTH_INTROSPECTION_CLIENT_ID'] ?? ''
}
