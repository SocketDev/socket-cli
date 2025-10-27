/**
 * Local path override for Socket CLI binary.
 * Useful for E2E testing different build variants (bin/cli.js, smol, SEA, etc).
 */

import { env } from 'node:process'

export const SOCKET_CLI_LOCAL_PATH = env['SOCKET_CLI_LOCAL_PATH']
