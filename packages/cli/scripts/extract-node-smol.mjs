/**
 * Download node-smol binaries from socket-btm GitHub releases.
 * This provides minimal Node.js v24.10.0 binaries for all platforms.
 *
 * Source: https://github.com/SocketDev/socket-btm/releases
 * Format: node-smol-builder-{DATE}-{COMMIT} tag with platform-specific assets
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
    logger.info('Extracting node-smol binary from socket-btm releases...')

    // Download node-smol binary using @socketsecurity/lib helper.
    // This handles version caching, platform detection, and file permissions automatically.
    const binaryPath = await downloadSocketBtmRelease({
      bin: 'node',
      cwd: rootPath,
      downloadDir: '../../build-infra/build/downloaded',
      envVar: 'SOCKET_BTM_NODE_SMOL_TAG',
      quiet: false,
      tool: 'node-smol',
    })

    logger.info(`Downloaded to ${binaryPath}`)

    logger.success('node-smol extraction complete')
  } catch (e) {
    logger.error(`Unexpected error: ${e.message}`)
    process.exit(1)
  }
}

main()
