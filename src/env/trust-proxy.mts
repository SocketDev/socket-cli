/**
 * TRUST_PROXY environment variable.
 *
 * When set to the literal string "true", the `socket mcp` HTTP server trusts
 * X-Forwarded-* headers from upstream proxies (e.g., when running behind a load
 * balancer that terminates TLS).
 *
 * Read lazily so tests that mutate process.env after module load see the latest
 * value.
 */

import process from 'node:process'

export function getTrustProxy(): boolean {
  return process.env['TRUST_PROXY'] === 'true'
}
