import { envAsString } from '@socketsecurity/lib/env'

/**
 * Override the socket-patch path for local development/testing.
 * When set, uses the local socket-patch CLI instead of downloading from npm.
 *
 * @example
 * ```bash
 * export SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH=/path/to/socket-patch/bin/cli.js
 * ```
 */
export const SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH = envAsString(
  process.env['SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH'],
)
