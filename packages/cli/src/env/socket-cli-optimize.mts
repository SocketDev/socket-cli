/**
 * SOCKET_CLI_OPTIMIZE environment variable snapshot.
 * Enables automatic optimization mode in Socket CLI.
 */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const SOCKET_CLI_OPTIMIZE = envAsBoolean(env['SOCKET_CLI_OPTIMIZE'])
