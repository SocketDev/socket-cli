/** @fileoverview SOCKET_CLI_NO_API_TOKEN environment variable. */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const SOCKET_CLI_NO_API_TOKEN = envAsBoolean(
  env['SOCKET_CLI_NO_API_TOKEN']
)
