/**
 * @fileoverview High-level SEA build orchestration.
 * Coordinates all SEA build steps for a single platform target.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { generateSeaConfig, injectSeaBlob } from './builder.mjs'
import { downloadNodeBinary } from '../utils/asset-manager-compat.mjs'
import { downloadExternalTools, logger } from './downloads.mjs'

/**
 * Build a single SEA target for a specific platform.
 * Orchestrates the complete SEA build process:
 * 1. Downloads node-smol binary for target platform.
 * 2. Downloads and packages security tools (if available).
 * 3. Generates SEA configuration.
 * 4. Injects blob and VFS into binary using binject.
 *
 * @param {object} target - Build target configuration.
 * @param {string} target.platform - Platform identifier (darwin, linux, win32).
 * @param {string} target.arch - Architecture identifier (arm64, x64).
 * @param {string} target.outputName - Output binary filename.
 * @param {string} target.nodeVersion - Node.js version tag suffix.
 * @param {string} [target.libc] - Linux libc variant ('musl' for Alpine).
 * @param {string} entryPoint - Absolute path to CLI entry point file.
 * @param {object} [options] - Build options.
 * @param {string} [options.outputDir] - Output directory for SEA binary (default: dist/sea).
 * @returns Promise resolving to absolute path of built SEA binary.
 *
 * @example
 * const target = {
 *   platform: 'darwin',
 *   arch: 'arm64',
 *   outputName: 'socket-darwin-arm64',
 *   nodeVersion: '20251213-7cf90d2'
 * }
 * const outputPath = await buildTarget(target, 'dist/cli.js', { outputDir: 'dist/sea' })
 * // Returns: dist/sea/socket-darwin-arm64
 */
// c8 ignore start - Requires downloading binaries, building blobs, and binary injection.
export async function buildTarget(target, entryPoint, options) {
  const { outputDir = normalizePath(path.join(process.cwd(), 'dist/sea')) } = {
    __proto__: null,
    ...options,
  }

  // Ensure output directory exists.
  await safeMkdir(outputDir)

  // Download Node.js binary for target platform.
  const nodeBinary = await downloadNodeBinary(
    target.nodeVersion,
    target.platform,
    target.arch,
    target.libc,
  )

  // Generate output path.
  const outputPath = normalizePath(path.join(outputDir, target.outputName))
  await safeMkdir(outputDir)

  // Create unique cache ID for parallel builds to prevent extraction cache conflicts.
  const cacheId = `${target.platform}-${target.arch}${target.libc ? `-${target.libc}` : ''}`

  // Download and package external security tools for VFS bundling.
  let vfsTarGz
  try {
    vfsTarGz = await downloadExternalTools(
      target.platform,
      target.arch,
      target.libc === 'musl',
    )
  } catch (e) {
    logger.warn(
      `Failed to download security tools for ${cacheId}: ${e.message}`,
    )
    logger.warn('Building without security tools VFS')
  }

  // Generate SEA configuration.
  const configPath = await generateSeaConfig(entryPoint, outputPath)

  try {
    // Inject SEA using config-based blob generation.
    // binject reads the config, generates the blob, and injects VFS in one operation.
    await injectSeaBlob(nodeBinary, configPath, outputPath, cacheId, vfsTarGz)

    // Make executable on Unix.
    if (target.platform !== 'win32') {
      await fs.chmod(outputPath, 0o755)
    }

    // Clean up generated blob file.
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
    if (config.output) {
      await safeDelete(config.output).catch(() => {})
    }
  } finally {
    // Clean up config.
    await safeDelete(configPath).catch(() => {})
  }

  return outputPath
}
// c8 ignore stop
