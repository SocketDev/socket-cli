/**
 * SOCKET_CLI_SKIP_UPDATE_CHECK environment variable snapshot.
 * When set to a truthy value, disables background update checks.
 * This prevents 30-second delays caused by HTTP keep-alive connections.
 */

import { env } from 'node:process'

export const SOCKET_CLI_SKIP_UPDATE_CHECK = env['SOCKET_CLI_SKIP_UPDATE_CHECK']
