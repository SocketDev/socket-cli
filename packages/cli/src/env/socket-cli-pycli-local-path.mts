/**
 * Local path override for Socket Python CLI binary.
 * Useful for local development and testing with custom Python CLI builds.
 */

import { env } from 'node:process'

export const SOCKET_CLI_PYCLI_LOCAL_PATH = env['SOCKET_CLI_PYCLI_LOCAL_PATH']
