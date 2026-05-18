/**
 * MCP_HTTP_MODE environment variable.
 *
 * When set to the literal string "true", forces the `socket mcp` command to
 * serve over HTTP instead of stdio. Useful in container / CI setups where stdio
 * binding isn't available.
 *
 * Read lazily so tests that mutate process.env after module load see the latest
 * value.
 */

import process from 'node:process'

export function getMcpHttpMode(): boolean {
  return process.env['MCP_HTTP_MODE'] === 'true'
}
