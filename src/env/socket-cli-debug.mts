/**
 * SOCKET_CLI_DEBUG environment variable snapshot.
 * Controls Socket CLI-specific debug output.
 */

import { env } from 'node:process'

export const SOCKET_CLI_DEBUG = env['SOCKET_CLI_DEBUG']
