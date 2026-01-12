/**
 * Local path override for socket-patch binary.
 * Useful for local development and testing with custom socket-patch builds.
 */

import { env } from 'node:process'

export const SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH =
  env['SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH']
