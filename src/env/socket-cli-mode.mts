/**
 * SOCKET_CLI_MODE environment variable snapshot.
 * Controls Socket CLI operational mode.
 */

import { env } from 'node:process'

export const SOCKET_CLI_MODE = env['SOCKET_CLI_MODE']
