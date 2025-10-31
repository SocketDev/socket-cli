/**
 * SOCKET_CLI_GIT_USER_EMAIL environment variable snapshot.
 * Overrides git user email for Socket CLI operations.
 * Falls back to 'github-actions[bot]@users.noreply.github.com' if not set.
 */

import { env } from 'node:process'

export const SOCKET_CLI_GIT_USER_EMAIL =
  env['SOCKET_CLI_GIT_USER_EMAIL'] ||
  'github-actions[bot]@users.noreply.github.com'
