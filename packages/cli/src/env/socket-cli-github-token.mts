/**
 * SOCKET_CLI_GITHUB_TOKEN environment variable snapshot.
 * Overrides GitHub token for Socket CLI operations.
 * Falls back to GITHUB_TOKEN, then GH_TOKEN if not set.
 */

import { getSocketCliGithubToken } from '@socketsecurity/lib/env/socket-cli'

function getGithubToken(): string {
  // Try Socket-specific env var first.
  const socketCliToken = getSocketCliGithubToken()
  if (socketCliToken) {
    return socketCliToken
  }

  // Fall back to standard GitHub env vars.
  return process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'] || ''
}

export const SOCKET_CLI_GITHUB_TOKEN = getGithubToken()
