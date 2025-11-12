/**
 * SOCKET_CLI_NODE_DOWNLOAD_URL environment variable snapshot.
 * Specifies the base URL for downloading Node.js binaries for SEA builds.
 *
 * Values:
 * - undefined (default): Uses https://nodejs.org/download/release (extracts from archives)
 * - 'socket-btm': Uses GitHub releases for SocketDev/socket-btm smol binaries (pre-compiled)
 *   Format: https://github.com/SocketDev/socket-btm/releases/download/node-smol-v{VERSION}/node-compiled-{PLATFORM}-{ARCH}[.exe]
 * - Custom URL: Uses specified base URL (e.g., internal mirror)
 *
 * @example
 * // Use socket-btm smol pre-compiled binaries
 * export SOCKET_CLI_NODE_DOWNLOAD_URL="socket-btm"
 * // Downloads: https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.0.0/node-compiled-darwin-arm64
 *
 * @example
 * // Use custom mirror
 * export SOCKET_CLI_NODE_DOWNLOAD_URL="https://internal-mirror.example.com/node"
 */

import { env } from 'node:process'

export const SOCKET_CLI_NODE_DOWNLOAD_URL = env['SOCKET_CLI_NODE_DOWNLOAD_URL']
