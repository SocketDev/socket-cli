/**
 * SOCKET_CLI_GIT_USER_NAME environment variable snapshot.
 * Overrides git user name for Socket CLI operations.
 * Checks SOCKET_CLI_GIT_USER_NAME, SOCKET_CLI_GIT_USERNAME, then falls back to 'github-actions[bot]'.
 */

import { env } from 'node:process'

export const SOCKET_CLI_GIT_USER_NAME =
  env['SOCKET_CLI_GIT_USER_NAME'] ||
  env['SOCKET_CLI_GIT_USERNAME'] ||
  'github-actions[bot]'
