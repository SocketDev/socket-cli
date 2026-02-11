/** @fileoverview SOCKET_CLI_OAUTH_REDIRECT_URI environment variable. */

import { env } from 'node:process'

export const SOCKET_CLI_OAUTH_REDIRECT_URI =
  env['SOCKET_CLI_OAUTH_REDIRECT_URI']
