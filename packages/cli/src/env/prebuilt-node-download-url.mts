/**
 * Base URL for downloading Node.js binaries for SEA builds.
 * Default: 'socket-btm' (uses smol binaries from socket-btm releases)
 * Can be set to 'https://nodejs.org/download/release' or custom URL.
 */

import { env } from 'node:process'

export const PREBUILT_NODE_DOWNLOAD_URL =
  env['PREBUILT_NODE_DOWNLOAD_URL'] || 'socket-btm'
