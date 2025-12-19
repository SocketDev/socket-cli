/**
 * Download binject binary from socket-btm GitHub releases.
 * This provides the binary injection tool for SEA (Single Executable Application) builds.
 *
 * Source: https://github.com/SocketDev/socket-btm/releases
 * Format: binject-{DATE}-{COMMIT} tag with platform-specific assets
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
  computeFileHash,
  downloadAsset,
  getCacheDir,
  getLatestRelease,
} from './utils/socket-btm-releases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

const cacheDir = getCacheDir('binject', rootPath)
const outputDir = path.join(rootPath, 'build/binject')

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
    return `binject-darwin-${mappedArch}`
  }
  if (platformName === 'linux') {
    // Default to musl for broader compatibility.
    return `binject-linux-musl-${mappedArch}`
  }
  if (platformName === 'win32') {
    return `binject-win-${mappedArch}.exe`
  }

  throw new Error(`Unsupported platform: ${platformName}`)
}

/**
 * Extract binary to output directory if needed.
 */
async function extractBinary(cachedPath, assetName) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(outputDir, { recursive: true })

  const outputPath = path.join(outputDir, assetName)

  // Check if extraction needed by comparing hashes.
  if (existsSync(outputPath)) {
    const cachedHash = await computeFileHash(cachedPath)
    const outputHash = await computeFileHash(outputPath)

    if (cachedHash === outputHash) {
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

  logger.success(`Extracted binary to ${outputPath}`)
}

/**
 * Main extraction logic.
 */
async function main() {
  try {
    logger.group('Extracting binject binary from socket-btm releases...')

    // Fetch latest binject release.
    const release = await getLatestRelease('binject-', 'SOCKET_BTM_BINJECT_TAG')
    if (!release) {
      logger.groupEnd()
      logger.warn('binject binary not available - skipping')
      process.exit(0)
    }

    const { tag } = release
    const assetName = getAssetName()

    // Download asset with caching.
    const cachedPath = await downloadAsset({ assetName, cacheDir, tag })

    // Extract to output directory.
    await extractBinary(cachedPath, assetName)

    logger.groupEnd()
    logger.log('')
    logger.success('binject extraction complete')
  } catch (e) {
    logger.groupEnd()
    logger.error(`Unexpected error: ${e.message}`)
    process.exit(1)
  }
}

main()
