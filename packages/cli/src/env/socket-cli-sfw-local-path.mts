/**
 * Local path override for socket-firewall binary.
 * Useful for local development and testing with custom firewall builds.
 */

import { env } from 'node:process'

export const SOCKET_CLI_SFW_LOCAL_PATH = env['SOCKET_CLI_SFW_LOCAL_PATH']
