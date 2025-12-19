/**
 * Download models from socket-btm GitHub releases.
 * This provides production models optimized with INT4 quantization.
 *
 * Source: https://github.com/SocketDev/socket-btm/releases
 * Models included: MiniLM-L6-v2, CodeT5
 *
 * Idempotent: Skips extraction if models are already cached and up to date.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  downloadAsset,
  findAsset,
  getCacheDir,
  getLatestRelease,
} from './utils/socket-btm-releases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

const cacheDir = getCacheDir('models', rootPath)
const outputDir = path.join(rootPath, 'build/models')

/**
 * Extract tar.gz to output directory if needed.
 */
async function extractModels(tarGzPath, releaseTag) {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(outputDir, { recursive: true })

  const markerPath = path.join(outputDir, '.extracted')

  // Check if already extracted and up to date.
  if (existsSync(markerPath)) {
    const markerContent = await readFile(markerPath, 'utf-8')
    if (markerContent === releaseTag) {
      logger.info('Models already up to date')
      return
    }
    logger.info('Models out of date, re-extracting...')
  } else {
    logger.info('Extracting models (this may take a minute)...')
  }

  // Extract tar.gz using tar command.
  const { spawn } = await import('@socketsecurity/lib/spawn')

  const result = await spawn('tar', ['-xzf', tarGzPath, '-C', outputDir], {
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`tar extraction failed with code ${result.code}`)
  }

  // Write marker file with release tag.
  await writeFile(markerPath, releaseTag, 'utf-8')
}

/**
 * Main extraction logic.
 */
async function main() {
  try {
    logger.group('Extracting models from socket-btm releases...')

    // Fetch latest models release.
    const release = await getLatestRelease('models-', 'SOCKET_BTM_MODELS_TAG')
    if (!release) {
      logger.groupEnd()
      logger.warn('Models not available - skipping')
      process.exit(0)
    }

    const { release: releaseData, tag } = release

    // Find tar.gz asset.
    const assetName = findAsset(releaseData, a => a.name.endsWith('.tar.gz'))
    if (!assetName) {
      logger.groupEnd()
      logger.warn('Models tar.gz not found - skipping')
      process.exit(0)
    }

    // Download asset with caching.
    const cachedPath = await downloadAsset({ assetName, cacheDir, tag })

    // Extract to output directory.
    await extractModels(cachedPath, tag)

    logger.groupEnd()
    logger.log('')
    logger.success('Models extraction complete')
  } catch (e) {
    logger.groupEnd()
    logger.error(`Unexpected error: ${e.message}`)
    process.exit(1)
  }
}

main()
