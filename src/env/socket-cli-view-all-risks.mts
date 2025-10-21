/** @fileoverview SOCKET_CLI_VIEW_ALL_RISKS environment variable. */

import { env } from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib/env'

export const SOCKET_CLI_VIEW_ALL_RISKS = envAsBoolean(
  env['SOCKET_CLI_VIEW_ALL_RISKS']
)
