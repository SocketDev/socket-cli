/**
 * Unified asset downloader for socket-btm releases.
 * Downloads and extracts all required assets from socket-btm GitHub releases.
 *
 * Usage:
 *   node scripts/download-assets.mjs [asset-names...] [options]
 *   node scripts/download-assets.mjs                 # Download all assets (parallel)
 *   node scripts/download-assets.mjs models           # Download specific assets (parallel)
 *   node scripts/download-assets.mjs --no-parallel   # Download all assets (sequential)
 *
 * Assets:
 *   binject   - Binary injection tool
 *   iocraft   - iocraft native bindings (.node files)
 *   models    - AI models tar.gz (MiniLM, CodeT5)
 *   node-smol - Minimal Node.js binaries
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logTransientErrorHelp } from 'build-infra/lib/github-error-utils'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Asset configuration.
 * Each asset defines how to download and process it.
 */
const ASSETS = {
  __proto__: null,
  binject: {
    description: 'Binary injection tool for SEA builds',
    download: {
      cwd: rootPath,
      downloadDir: '../../packages/build-infra/build/downloaded',
      envVar: 'SOCKET_BTM_BINJECT_TAG',
      quiet: false,
      tool: 'binject',
    },
    name: 'binject',
    type: 'binary',
  },
  iocraft: {
    description: 'iocraft native bindings (.node files)',
    download: {
      asset: 'iocraft-*.node',
      cwd: rootPath,
      downloadDir: '../../packages/build-infra/build/downloaded/iocraft',
      quiet: false,
      tool: 'iocraft',
    },
    name: 'iocraft',
    type: 'multi-platform',
  },
  opentui: {
    description: 'opentui native bindings (.node files)',
    download: {
      asset: 'opentui-*.node',
      cwd: rootPath,
      downloadDir: '../../packages/build-infra/build/downloaded/opentui',
      quiet: false,
      tool: 'opentui',
    },
    name: 'opentui',
    type: 'multi-platform',
  },
  models: {
    description: 'AI models (MiniLM-L6-v2, CodeT5)',
    download: {
      asset: 'models-*.tar.gz',
      cwd: rootPath,
      downloadDir: '../../packages/build-infra/build/downloaded',
      quiet: false,
      tool: 'models',
    },
    extract: {
      format: 'tar.gz',
      outputDir: path.join(rootPath, 'build/models'),
    },
    name: 'models',
    type: 'archive',
  },
  'node-smol': {
    description: 'Minimal Node.js v24.10.0 binaries',
    download: {
      bin: 'node',
      cwd: rootPath,
      downloadDir: '../../packages/build-infra/build/downloaded',
      envVar: 'SOCKET_BTM_NODE_SMOL_TAG',
      quiet: false,
      tool: 'node-smol',
    },
    name: 'node-smol',
    type: 'binary',
  },
}

/**
 * Download a single asset.
 */
async function downloadAsset(config) {
  const { description, download, extract, name, type } = config

  try {
    logger.group(`Extracting ${name} from socket-btm releases...`)
    logger.info(description)

    // Download the asset.
    let assetPath
    try {
      // Extract tool name from download config.
      const { tool, ...downloadOptions } = download
      assetPath = await downloadSocketBtmRelease(tool, downloadOptions)
      logger.info(`Downloaded to ${assetPath}`)
    } catch (e) {
      // Some assets are optional (models).
      if (name === 'models') {
        logger.warn(`${name} not available: ${e.message}`)
        logger.groupEnd()
        return { name, ok: true, skipped: true }
      }
      throw e
    }

    // Process based on asset type.
    if (type === 'archive' && extract) {
      await extractArchive(assetPath, extract, name)
    }

    logger.groupEnd()
    logger.success(`${name} extraction complete`)
    return { name, ok: true }
  } catch (error) {
    logger.groupEnd()
    logger.error(`Failed to extract ${name}: ${error.message}`)
    await logTransientErrorHelp(error)
    return { error, name, ok: false }
  }
}

/**
 * Extract tar.gz archive.
 */
async function extractArchive(tarGzPath, extractConfig, assetName) {
  const { outputDir } = extractConfig

  await fs.mkdir(outputDir, { recursive: true })

  const versionPath = path.join(outputDir, '.version')
  const assetDir = path.dirname(tarGzPath)
  const sourceVersionPath = path.join(assetDir, '.version')

  // Get release tag for cache validation.
  if (!existsSync(sourceVersionPath)) {
    throw new Error(
      `Source version file not found: ${sourceVersionPath}. ` +
        'Please download assets first using the build system.',
    )
  }

  const tag = (await fs.readFile(sourceVersionPath, 'utf8')).trim()
  if (!tag || tag.length === 0) {
    throw new Error(
      `Invalid version file content at ${sourceVersionPath}. ` +
        'Please re-download assets.',
    )
  }

  // Check if already extracted and up to date.
  if (existsSync(versionPath)) {
    const cachedVersion = await fs.readFile(versionPath, 'utf-8')
    if (cachedVersion.trim() === tag) {
      logger.info(`${assetName} already up to date`)
      return
    }
    logger.info(`${assetName} out of date, re-extracting...`)
  } else {
    logger.info(`Extracting ${assetName} (this may take a minute)...`)
  }

  // Extract tar.gz using tar command.
  const result = await spawn('tar', ['-xzf', tarGzPath, '-C', outputDir], {
    stdio: 'inherit',
  })

  if (!result) {
    throw new Error('Failed to start tar extraction')
  }

  if (result.code !== 0) {
    throw new Error(`tar extraction failed with code ${result.code}`)
  }

  // Write version file with release tag.
  await fs.writeFile(versionPath, tag, 'utf-8')
}

/**
 * Download multiple assets (parallel by default, sequential opt-in).
 *
 * Parallel mode is optimized for fast builds. Assets are downloaded concurrently
 * and have isolated subdirectories to minimize race conditions.
 *
 * Use --no-parallel flag for sequential mode if filesystem issues occur.
 */
async function downloadAssets(assetNames, parallel = true) {
  if (parallel) {
    const settled = await Promise.allSettled(
      assetNames.map(name => downloadAsset(ASSETS[name])),
    )

    const failed = settled.filter(
      r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
    )
    if (failed.length > 0) {
      logger.error(`\n${failed.length} asset(s) failed:`)
      for (const r of failed) {
        logger.error(
          `  - ${r.status === 'rejected' ? r.reason?.message ?? r.reason : r.value.name}`,
        )
      }
      process.exitCode = 1
    }
  } else {
    for (const name of assetNames) {
      const result = await downloadAsset(ASSETS[name])
      if (!result.ok && !result.skipped) {
        process.exitCode = 1
        return
      }
    }
  }
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const parallel = !args.includes('--no-parallel')
  const assetArgs = args.filter(arg => !arg.startsWith('--'))

  // Determine which assets to download.
  const assetNames = assetArgs.length > 0 ? assetArgs : Object.keys(ASSETS)

  // Validate asset names.
  for (const name of assetNames) {
    if (!(name in ASSETS)) {
      logger.error(`Unknown asset: ${name}`)
      logger.error(`Available assets: ${Object.keys(ASSETS).join(', ')}`)
      process.exitCode = 1
      return
    }
  }

  await downloadAssets(assetNames, parallel)
}

// Run if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    logger.error('Asset download failed:', error)
    process.exitCode = 1
  })
}

export { ASSETS, downloadAsset, downloadAssets }
