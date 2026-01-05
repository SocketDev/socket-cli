/**
 * Download node-smol binaries from socket-btm GitHub releases.
 * This provides minimal Node.js v24.10.0 binaries for all platforms.
 *
 * Source: https://github.com/SocketDev/socket-btm/releases
 * Format: node-smol-builder-{DATE}-{COMMIT} tag with platform-specific assets
 *
 * Idempotent: Skips download if cached file matches expected hash.
 */

import { existsSync } from 'node:fs'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  downloadAsset,
  getCacheDir,
  getLatestRelease,
} from './utils/socket-btm-releases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

const cacheDir = getCacheDir('node-smol', rootPath)
// Extract to centralized location: packages/build-infra/build/downloaded/node-smol/{platform-arch}/
const outputDir = getCacheDir('node-smol', rootPath)

/**
 * Get the appropriate binary asset name for the current platform.
 */
function getAssetName() {
  const platformName = platform()
  const archName = arch()

  // Map Node.js arch names to asset names.
  const archMap = {
    __proto__: null,
    arm64: 'arm64',
    x64: 'x64',
  }

  const mappedArch = archMap[archName]
  if (!mappedArch) {
    throw new Error(`Unsupported architecture: ${archName}`)
  }

  // Map platform names to asset names.
  if (platformName === 'darwin') {
    return `node-v24.10.0-darwin-${mappedArch}`
  }
  if (platformName === 'linux') {
    return `node-v24.10.0-linux-${mappedArch}`
  }
  if (platformName === 'win32') {
    return `node-v24.10.0-win-${mappedArch}.exe`
  }

  throw new Error(`Unsupported platform: ${platformName}`)
}

/**
 * Extract binary to output directory if needed.
 */
async function extractBinary(cachedPath, assetName, tag) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(outputDir, { recursive: true })

  const outputPath = path.join(outputDir, assetName)
  const versionPath = path.join(outputDir, '.version')

  // Check if extraction needed by checking version.
  if (existsSync(versionPath) && existsSync(outputPath)) {
    const cachedVersion = (await readFile(versionPath, 'utf8')).trim()
    if (cachedVersion === tag) {
      logger.info(`Binary already up to date: ${outputPath}`)
      return
    }
  }

  // Copy binary to output directory.
  const content = await readFile(cachedPath)
  await writeFile(outputPath, content)

  // Make executable on Unix-like systems.
  if (platform() !== 'win32') {
    await chmod(outputPath, 0o755)
  }

  // Write version file.
  await writeFile(versionPath, tag, 'utf8')

  logger.success(`Extracted binary to ${outputPath}`)
}

/**
 * Main extraction logic.
 */
async function main() {
  try {
    logger.info('Extracting node-smol binary from socket-btm releases...')

    // Fetch latest node-smol release.
    const release = await getLatestRelease(
      'node-smol-builder-',
      'SOCKET_BTM_NODE_SMOL_TAG',
    )
    if (!release) {
      logger.warn('node-smol binary not available - skipping')
      process.exit(0)
    }

    const { tag } = release
    const assetName = getAssetName()

    // Download asset with caching.
    const cachedPath = await downloadAsset({ assetName, cacheDir, tag })

    // Extract to output directory.
    await extractBinary(cachedPath, assetName, tag)

    logger.success('node-smol extraction complete')
  } catch (e) {
    logger.error(`Unexpected error: ${e.message}`)
    process.exit(1)
  }
}

main()
