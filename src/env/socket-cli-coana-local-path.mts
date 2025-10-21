/**
 * SOCKET_CLI_COANA_LOCAL_PATH environment variable snapshot.
 * Overrides the default Coana CLI path for local development.
 */

import { env } from 'node:process'

export const SOCKET_CLI_COANA_LOCAL_PATH = env['SOCKET_CLI_COANA_LOCAL_PATH']
