/**
 * @file SEA binary builder - configuration, blob generation, and injection.
 *   Consolidated module for all SEA, Single Executable Application, build
 *   operations. Sections:
 *
 *   1. SEA Configuration Generation - Creates sea-config.json files.
 *   2. SEA Blob Generation - Builds blobs from configuration files.
 *   3. Binary Injection - Injects blobs and VFS into Node.js binaries using
 *      binject.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { downloadBinject } from '../util/asset-manager-compat.mts'
import { BINJECT_VERSION } from '../constants/base-assets.mts'
import { SOCKET_CLI_SEA_BUILD_DIR } from '../constants/paths.mts'

// =============================================================================
// Section 1: SEA Configuration Generation.
// =============================================================================

// c8 ignore start
/**
 * Generate the SEA configuration file for a Node.js single executable, written
 * beside the output binary as sea-config-{name}.json. Code cache is on,
 * snapshot is off, and no assets are bundled so the blob stays small.
 *
 * @param {string} entryPoint - Absolute path to the entry point file.
 * @param {string} outputPath - Absolute path to the output binary.
 *
 * @returns Promise resolving to absolute path of generated config file.
 */
export async function generateSeaConfig(entryPoint, outputPath) {
  const outputName = path.basename(outputPath, path.extname(outputPath))
  const configDir = path.dirname(outputPath)
  const configPath = normalizePath(
    path.join(configDir, `sea-config-${outputName}.json`),
  )
  // Use relative paths in sea-config.json, binject requires relative paths.
  const blobPathRelative = `sea-blob-${outputName}.blob`
  const mainPathRelative = path.relative(configDir, entryPoint)

  const config = {
    // No assets to minimize size.
    assets: {},
    disableExperimentalSEAWarning: true,
    main: mainPathRelative,
    output: blobPathRelative,
    // Enable code cache for ~13% faster startup (~22ms improvement).
    // Pre-compiles JavaScript code during build time for instant execution.
    useCodeCache: true,
    // Disable snapshots - incompatible with socket-cli's environment variable architecture.
    // socket-cli accesses ~70 env vars at module load time (HOME, SOCKET_CLI_API_TOKEN, etc.).
    // Snapshots would freeze build-time env values, breaking runtime configuration.
    // Code cache + bundling provides ~25-30% startup improvement without restrictions.
    useSnapshot: false,
    // Update configuration for built-in update checking.
    // The node-smol C stub will check for updates on exit and display notifications.
    updateConfig: {
      // Check GitHub releases API for socket-cli releases.
      checkIntervalSeconds: 86_400,
      tagPrefix: 'socket-cli-',
      url: 'https://api.github.com/repos/SocketDev/socket-cli/releases',
    },
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return configPath
}
// c8 ignore stop

// =============================================================================
// Section 2: SEA Blob Generation, handled by binject.
// =============================================================================

// Blob generation is now handled automatically by binject when --sea points to
// a .json config file. The previous buildSeaBlob() function has been removed
// because binject can generate the blob using the target binary's Node.js version,
// which is critical for useCodeCache support, code cache is version-specific.
//
// This eliminates the Node.js version mismatch issue where we were using the host
// Node.js to generate blobs for node-smol targets with different Node.js versions.
//
// See injectSeaBlob() below for the config-based blob generation implementation.

// =============================================================================
// Section 3: Binary Injection.
// =============================================================================

/**
 * Inject the SEA blob, and optionally the VFS assets, into a Node.js binary
 * using binject. binject reads sea-config.json directly and generates the blob
 * itself, so there is no separate `node --experimental-sea-config` pass.
 *
 * @param {string} nodeBinary - Path to the node-smol binary to inject into.
 * @param {string} configPath - Path to the sea-config.json file for
 *   config-based blob generation.
 * @param {string} outputPath - Path to the output SEA binary. May be the same
 *   path as nodeBinary, which injects in place.
 * @param {string} cacheId - Unique per-build id that keeps parallel builds from
 *   sharing an extraction cache.
 * @param {string} [vfsTarGz] - Tar.gz of security tools to embed via binject
 *   `--vfs`, which compresses them ~70% against Node.js SEA assets. Omit it and
 *   binject runs in `--vfs-compat` mode, bundling the CLI alone.
 *
 * @returns Promise that resolves when injection completes.
 */
export async function injectSeaBlob(
  nodeBinary,
  configPath,
  outputPath,
  cacheId,
  vfsTarGz,
) {
  // Download the pinned binject binary. The version is frozen in
  // constants/base-assets.mts (no latest-release lookup — socket-btm is
  // descoped and the pinned assets are mirrored into socket-cli releases).
  const binjectPath = await downloadBinject(BINJECT_VERSION)

  // Create unique temp directory for this build's extraction cache.
  // This prevents parallel builds from interfering with each other.
  const env = { ...process.env }
  if (cacheId) {
    const uniqueCacheDir = normalizePath(
      path.join(SOCKET_CLI_SEA_BUILD_DIR, cacheId),
    )
    await safeMkdir(uniqueCacheDir)
    env['SOCKET_DLX_DIR'] = uniqueCacheDir
  }

  // Inject SEA blob into Node binary using binject.
  const args = [
    'inject',
    '--executable',
    nodeBinary,
    '--output',
    outputPath,
    '--sea',
    configPath,
  ]

  // Add VFS if provided (compressed tar.gz), otherwise use vfs-compat mode.
  if (vfsTarGz && existsSync(vfsTarGz)) {
    args.push('--vfs', vfsTarGz)
  } else {
    args.push('--vfs-compat')
  }

  const result = await spawn(binjectPath, args, { env, stdio: 'inherit' })

  if (
    result !== null &&
    typeof result === 'object' &&
    'code' in result &&
    result.code !== 0
  ) {
    throw new Error(`binject failed with exit code ${result.code}`)
  }
}
