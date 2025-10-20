/**
 * SOCKET_CLI_FIX environment variable snapshot.
 * Enables automatic fix mode in Socket CLI.
 */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const SOCKET_CLI_FIX = envAsBoolean(env['SOCKET_CLI_FIX'])
