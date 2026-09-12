/**
 * SOCKET_CLI_ALLOWED_PRIVATE_HOSTS environment variable.
 *
 * Comma-separated hostnames that may resolve to a loopback, private, or
 * link-local address when Socket CLI validates an operator-configured endpoint
 * that receives credentials — the Socket API base URL and the npm registry URL.
 * Unset by default, so every private host is refused.
 *
 * An entry is a bare hostname, matched case-insensitively against the URL's
 * hostname: `socket.internal.example,10.0.0.5`. It is an allowlist rather than
 * a blanket off switch so a repo-supplied `SOCKET_CLI_CONFIG` or `.npmrc`
 * cannot redirect a token to some other private host once the operator has
 * named their own.
 *
 * Read lazily so a late `process.env` write is observed.
 */

import process from 'node:process'

export function getSocketCliAllowedPrivateHosts(): string[] {
  const raw = process.env['SOCKET_CLI_ALLOWED_PRIVATE_HOSTS']
  if (!raw) {
    return []
  }
  const parts = raw.split(',')
  const hosts = []
  for (let i = 0, { length } = parts; i < length; i += 1) {
    const host = parts[i]!.trim().toLowerCase()
    if (host) {
      hosts.push(host)
    }
  }
  return hosts
}
