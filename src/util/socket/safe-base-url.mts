/**
 * @file SSRF guard for the Socket API base URL. The base URL is where the CLI
 *   sends `Authorization: Basic <token>`, and it is operator-settable through
 *   the SOCKET_CLI_API_BASE_URL env var or the allowlisted `apiBaseUrl`
 *   SOCKET_CLI_CONFIG key, so it is validated before any credential leaves the
 *   box.
 */

import { CONFIG_KEY_API_BASE_URL } from '../../constants/config.mts'
import { assertSafeEndpointUrl } from '../url/safe-endpoint.mts'

const SOCKET_API_BASE_URL_LABEL = 'Socket API base URL'

const SOCKET_API_BASE_URL_SOURCE = `the SOCKET_CLI_API_BASE_URL env var or the "${CONFIG_KEY_API_BASE_URL}" config key`

/**
 * Assert `rawUrl` is a public http(s) endpoint safe to send the Socket API
 * token to, returning the parsed `URL`. Throws otherwise.
 */
export function assertSafeSocketApiBaseUrl(rawUrl: string): URL {
  return assertSafeEndpointUrl(rawUrl, {
    label: SOCKET_API_BASE_URL_LABEL,
    source: SOCKET_API_BASE_URL_SOURCE,
  })
}
