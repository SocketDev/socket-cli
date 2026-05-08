/**
 * MCP_PORT environment variable.
 *
 * Port the `socket mcp` HTTP server should listen on when running in HTTP
 * mode. Empty string when unset; the caller decides the default.
 *
 * Read lazily so tests that mutate process.env after module load see the
 * latest value.
 */

import process from 'node:process'

export function getMcpPort(): string {
  return process.env['MCP_PORT'] ?? ''
}
