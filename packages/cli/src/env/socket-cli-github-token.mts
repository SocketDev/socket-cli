/**
 * SOCKET_CLI_GITHUB_TOKEN environment variable snapshot.
 * Overrides GitHub token for Socket CLI operations.
 */

import { env } from 'node:process'

export const SOCKET_CLI_GITHUB_TOKEN = env['SOCKET_CLI_GITHUB_TOKEN']
