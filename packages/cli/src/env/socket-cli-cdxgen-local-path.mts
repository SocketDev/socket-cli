/**
 * Local path override for cdxgen binary.
 * Useful for local development and testing with custom cdxgen builds.
 */

import { env } from 'node:process'

export const SOCKET_CLI_CDXGEN_LOCAL_PATH = env['SOCKET_CLI_CDXGEN_LOCAL_PATH']
