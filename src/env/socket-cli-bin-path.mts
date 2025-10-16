/**
 * SOCKET_CLI_BIN_PATH environment variable snapshot.
 * Overrides the default Socket CLI binary path.
 */

import { env } from 'node:process'

export const SOCKET_CLI_BIN_PATH = env['SOCKET_CLI_BIN_PATH']
