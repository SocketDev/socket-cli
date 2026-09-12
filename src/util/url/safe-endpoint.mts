/**
 * @file SSRF guard for operator-configured endpoints that receive credentials.
 *   Wraps the shared `assertSafeHttpUrl` so a Socket API base URL or an npm
 *   registry URL cannot be aimed at a loopback, private, or link-local host
 *   (cloud metadata at 169.254.169.254, an internal service) and carry the
 *   Authorization header with it. An operator running an enterprise deployment
 *   on a private host names that hostname in SOCKET_CLI_ALLOWED_PRIVATE_HOSTS.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { assertSafeHttpUrl } from '@socketsecurity/lib-stable/url/assert-safe'
import { isPrivateHost } from '@socketsecurity/lib-stable/url/predicates'

import { getSocketCliAllowedPrivateHosts } from '../../env/socket-cli-allowed-private-hosts.mts'

export interface AssertSafeEndpointUrlOptions {
  label?: string | undefined
  source?: string | undefined
}

/**
 * Parse `rawUrl` and assert it is safe to send credentials to, returning the
 * parsed `URL`. Throws when the value does not parse, uses a scheme other than
 * http(s), or resolves to a private host the operator has not allowlisted.
 */
export function assertSafeEndpointUrl(
  rawUrl: string,
  options?: AssertSafeEndpointUrlOptions | undefined,
): URL {
  const { label = 'URL', source = 'the configured value' } = {
    __proto__: null,
    ...options,
  } as AssertSafeEndpointUrlOptions
  try {
    return assertSafeHttpUrl(rawUrl, { label })
  } catch (e) {
    if (isAllowedPrivateEndpointUrl(rawUrl)) {
      return new URL(rawUrl)
    }
    throw new Error(
      `${label} is refused. Where: ${source}. Saw: ${errorMessage(e)} Wanted: an absolute http(s) URL on a public host. Fix: point ${source} at a public endpoint, or add the hostname to SOCKET_CLI_ALLOWED_PRIVATE_HOSTS (comma-separated) to allow a private enterprise deployment.`,
    )
  }
}

/**
 * Whether `rawUrl` is an http(s) URL whose private hostname the operator listed
 * in SOCKET_CLI_ALLOWED_PRIVATE_HOSTS. Public hosts, non-http(s) schemes, and
 * unparseable values are never allowlisted, so the allowlist can only ever undo
 * the private-host refusal.
 */
export function isAllowedPrivateEndpointUrl(rawUrl: string): boolean {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false
  }
  const hostname = url.hostname.toLowerCase()
  if (!isPrivateHost(hostname)) {
    return false
  }
  return getSocketCliAllowedPrivateHosts().includes(hostname)
}
