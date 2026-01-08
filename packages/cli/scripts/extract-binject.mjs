/**
 * Download binject binary from socket-btm GitHub releases.
 * This provides the binary injection tool for SEA (Single Executable Application) builds.
 *
 * Source: https://github.com/SocketDev/socket-btm/releases
 * Format: binject-{DATE}-{COMMIT} tag with platform-specific assets
 *
 * Idempotent: Skips download if cached file matches expected hash.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Main extraction logic.
 */
async function main() {
  try {
    logger.group('Extracting binject binary from socket-btm releases...')

    // Download binject binary using @socketsecurity/lib helper.
    // This handles version caching, platform detection, and file permissions automatically.
    const binaryPath = await downloadSocketBtmRelease({
      cwd: rootPath,
      downloadDir: '../../packages/build-infra/build/downloaded',
      envVar: 'SOCKET_BTM_BINJECT_TAG',
      quiet: false,
      tool: 'binject',
    })

    logger.info(`Downloaded to ${binaryPath}`)

    logger.groupEnd()
    logger.success('binject extraction complete')
  } catch (e) {
    logger.groupEnd()
    logger.error(`Unexpected error: ${e.message}`)
    process.exit(1)
  }
}

main()
