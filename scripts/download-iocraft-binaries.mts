#!/usr/bin/env node
/**
 * Download iocraft .node binaries from socket-btm releases for all platforms.
 *
 * This script is used by the publish workflow to download native binaries
 * before publishing @socketaddon/iocraft platform packages.
 *
 * Usage:
 *   node scripts/download-iocraft-binaries.mjs [--platform=<platform>] [--arch=<arch>] [--libc=<libc>]
 *   node scripts/download-iocraft-binaries.mjs                          # Download all platforms
 *   node scripts/download-iocraft-binaries.mjs --platform=darwin --arch=arm64
 *   node scripts/download-iocraft-binaries.mjs --platform=linux --arch=x64 --libc=musl
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PLATFORM_CONFIGS,
  parsePlatformArgs,
} from '../packages/build-infra/lib/platform-targets.mts'
import { logTransientErrorHelp } from '../packages/build-infra/lib/github-error-utils.mts'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { downloadSocketBtmRelease } from '@socketsecurity/lib/releases/socket-btm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

interface DownloadResult {
  ok: boolean
  target: string
  error?: unknown
}

interface PlatformConfig {
  arch: string
  description: string
  libc?: string
  platform: string
  releasePlatform: string
  runner: string
}

interface PlatformFilter {
  platform: string
  arch: string
  libc?: string
}

/**
 * Get output path for a platform-specific .node binary.
 */
function getBinaryOutputPath(
  platform: string,
  arch: string,
  libc: string | undefined,
): string {
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  const releasePlatform = platform === 'win32' ? 'win' : platform
  const target = `${releasePlatform}-${arch}${muslSuffix}`
  return path.join(
    rootPath,
    'packages/build-infra/build/downloaded/iocraft',
    target,
    'iocraft.node',
  )
}

/**
 * Download iocraft binary for a specific platform.
 */
async function downloadIocraftBinary(
  config: PlatformConfig,
): Promise<DownloadResult> {
  const { arch, description, libc, platform, releasePlatform } = config
  const target = `${releasePlatform}-${arch}${libc ? `-${libc}` : ''}`

  try {
    logger.group(`Downloading iocraft for ${target}`)
    logger.info(description)

    const outputPath = getBinaryOutputPath(platform, arch, libc)
    const outputDir = path.dirname(outputPath)

    await fs.mkdir(outputDir, { recursive: true })

    // Check if already downloaded by checking version.
    const versionPath = path.join(outputDir, '.version')
    const downloadDir = path.join(
      rootPath,
      'packages/build-infra/build/downloaded/iocraft-temp',
    )

    // Download the asset.
    let assetPath: string
    try {
      const assetPattern = `iocraft-*-${target}.node`
      assetPath = await downloadSocketBtmRelease('iocraft', {
        asset: assetPattern,
        cwd: rootPath,
        downloadDir,
        quiet: false,
      })
      logger.info(`Downloaded to ${assetPath}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error(`Failed to download ${target}: ${message}`)
      await logTransientErrorHelp(e)
      throw e
    }

    // Get the release tag from the download directory.
    const sourceVersionPath = path.join(downloadDir, '.version')
    if (!existsSync(sourceVersionPath)) {
      throw new Error(
        `Source version file not found: ${sourceVersionPath}. ` +
          'Download may have failed.',
      )
    }

    const tag = (await fs.readFile(sourceVersionPath, 'utf8')).trim()
    if (!tag || tag.length === 0) {
      throw new Error(
        `Invalid version file content at ${sourceVersionPath}. ` +
          'Please retry download.',
      )
    }

    // Check if already up to date.
    if (existsSync(versionPath)) {
      const cachedVersion = await fs.readFile(versionPath, 'utf-8')
      if (cachedVersion.trim() === tag) {
        logger.info(`${target} already up to date`)
        logger.groupEnd()
        return { ok: true, target }
      }
      logger.info(`${target} out of date, re-downloading...`)
    }

    // Copy the .node file to the output location.
    await fs.copyFile(assetPath, outputPath)

    // Write version file.
    await fs.writeFile(versionPath, tag, 'utf-8')

    logger.groupEnd()
    logger.success(`${target} download complete`)
    return { ok: true, target }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.groupEnd()
    logger.error(`Failed to download ${target}: ${message}`)
    await logTransientErrorHelp(e)
    return { error: e, ok: false, target }
  }
}

/**
 * Download binaries for all platforms or a specific platform.
 */
async function downloadBinaries(
  platformFilter: PlatformFilter | null = null,
): Promise<boolean> {
  const configs = platformFilter
    ? PLATFORM_CONFIGS.filter(
        c =>
          c.platform === platformFilter.platform &&
          c.arch === platformFilter.arch &&
          (platformFilter.libc ? c.libc === platformFilter.libc : !c.libc),
      )
    : PLATFORM_CONFIGS

  if (configs.length === 0) {
    logger.error(
      'No matching platforms found for filter:',
      JSON.stringify(platformFilter),
    )
    return false
  }

  logger.info(
    `Downloading iocraft binaries for ${configs.length} platform(s)...`,
  )

  const settled = await Promise.allSettled(
    configs.map(config => downloadIocraftBinary(config)),
  )

  const failed = settled.filter(
    r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
  )
  if (failed.length > 0) {
    logger.error(`\n${failed.length} platform(s) failed:`)
    for (const r of failed) {
      logger.error(`  - ${r.status === 'rejected' ? r.reason?.message ?? r.reason : r.value.target}`)
    }
    return false
  }

  logger.success(`\nAll ${configs.length} platform(s) downloaded successfully`)
  return true
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const platformArgs = parsePlatformArgs(args)

  // Determine if filtering to a specific platform.
  const hasFilter = platformArgs.platform || platformArgs.arch
  const platformFilter = hasFilter ? platformArgs : null

  if (hasFilter && !platformArgs.platform) {
    logger.error('--arch requires --platform')
    process.exitCode = 1
    return
  }

  const success = await downloadBinaries(platformFilter)
  if (!success) {
    process.exitCode = 1
  }
}

// Run if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    logger.error('Download failed:', e)
    process.exitCode = 1
  })
}

export { downloadBinaries, downloadIocraftBinary, getBinaryOutputPath }
