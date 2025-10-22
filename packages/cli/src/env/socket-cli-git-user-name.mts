/**
 * SOCKET_CLI_GIT_USER_NAME environment variable snapshot.
 * Overrides git user name for Socket CLI operations.
 */

import { env } from 'node:process'

export const SOCKET_CLI_GIT_USER_NAME = env['SOCKET_CLI_GIT_USER_NAME']
