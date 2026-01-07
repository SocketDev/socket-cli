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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  findReleaseAsset,
  SOCKET_BTM_REPO,
} from '@socketsecurity/lib/releases/github'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

const outputDir = path.join(rootPath, 'build/models')

/**
 * Extract tar.gz to output directory if needed.
 */
async function extractModels(tarGzPath, releaseTag) {
  await mkdir(outputDir, { recursive: true })

  const versionPath = path.join(outputDir, '.version')

  // Check if already extracted and up to date.
  if (existsSync(versionPath)) {
    const cachedVersion = await readFile(versionPath, 'utf-8')
    if (cachedVersion.trim() === releaseTag) {
      logger.info('Models already up to date')
      return
    }
    logger.info('Models out of date, re-extracting...')
  } else {
    logger.info('Extracting models (this may take a minute)...')
  }

  // Extract tar.gz using tar command.
  const result = await spawn('tar', ['-xzf', tarGzPath, '-C', outputDir], {
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`tar extraction failed with code ${result.code}`)
  }

  // Write version file with release tag.
  await writeFile(versionPath, releaseTag, 'utf-8')
}

/**
 * Main extraction logic.
 */
async function main() {
  try {
    logger.group('Extracting models from socket-btm releases...')

    let assetPath
    try {
      // Find the latest models asset dynamically.
      // Asset name pattern: models-{DATE}-{COMMIT}.tar.gz
      const result = await findReleaseAsset(
        'models-',
        { prefix: 'models-', suffix: '.tar.gz' },
        SOCKET_BTM_REPO,
        { quiet: false },
      )

      if (!result) {
        throw new Error('No models release with matching asset found')
      }

      const { assetName } = result

      // Download models tar.gz asset using @socketsecurity/lib helper.
      // This handles version caching automatically.
      assetPath = await downloadSocketBtmRelease({
        asset: assetName,
        cwd: rootPath,
        downloadDir: '../../build-infra/build/downloaded',
        quiet: false,
        tool: 'models',
      })
    } catch (e) {
      logger.groupEnd()
      logger.warn(`Models not available: ${e.message}`)
      process.exit(0)
    }

    // Get tag from source version file.
    const assetDir = path.dirname(assetPath)
    const sourceVersionPath = path.join(assetDir, '.version')
    const tag = existsSync(sourceVersionPath)
      ? (await readFile(sourceVersionPath, 'utf8')).trim()
      : 'unknown'

    // Extract to output directory.
    await extractModels(assetPath, tag)

    logger.groupEnd()
    logger.success('Models extraction complete')
  } catch (e) {
    logger.groupEnd()
    logger.error(`Unexpected error: ${e.message}`)
    process.exit(1)
  }
}

main()
