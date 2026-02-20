/**
 * Local path override for Python executable.
 * Useful for local development and testing with custom Python installations.
 */

import { env } from 'node:process'

export const SOCKET_CLI_PYTHON_PATH = env['SOCKET_CLI_PYTHON_PATH']
