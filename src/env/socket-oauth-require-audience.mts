/**
 * SOCKET_OAUTH_REQUIRE_AUDIENCE environment variable.
 *
 * Turns on strict RFC 8707 audience enforcement for the `socket mcp` HTTP
 * server: an introspection response carrying no `aud` claim is rejected. Off by
 * default, because an authorization server that never emits `aud` would
 * otherwise fail every request. An `aud` that IS present and names a different
 * resource is rejected whether or not this is set.
 *
 * Read lazily so tests that mutate process.env after module load see the latest
 * value.
 */

import process from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib-stable/env/boolean'

export function getSocketOauthRequireAudience(): boolean {
  return envAsBoolean(process.env['SOCKET_OAUTH_REQUIRE_AUDIENCE'])
}
