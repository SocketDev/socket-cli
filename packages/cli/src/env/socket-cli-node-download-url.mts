/**
 * Base URL for downloading Node.js binaries for SEA builds.
 * Default: https://nodejs.org/download/release
 * Can be set to 'socket-btm' or custom URL.
 */

import { env } from 'node:process'

export const SOCKET_CLI_NODE_DOWNLOAD_URL = env['SOCKET_CLI_NODE_DOWNLOAD_URL']
