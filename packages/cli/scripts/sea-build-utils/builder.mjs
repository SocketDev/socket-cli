/**
 * @fileoverview SEA binary builder - configuration, blob generation, and injection.
 * Consolidated module for all SEA (Single Executable Application) build operations.
 *
 * Sections:
 * 1. SEA Configuration Generation - Creates sea-config.json files.
 * 2. SEA Blob Generation - Builds blobs from configuration files.
 * 3. Binary Injection - Injects blobs and VFS into Node.js binaries using binject.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  detectMusl,
  downloadBinject,
  getLatestBinjectVersion,
} from '../utils/asset-manager-compat.mjs'
import { getRootPath, logger } from './downloads.mjs'
import { SOCKET_CLI_SEA_BUILD_DIR } from '../constants/paths.mjs'

// =============================================================================
// Section 1: SEA Configuration Generation.
// =============================================================================

// c8 ignore start
/**
 * Generate SEA configuration file for Node.js single executable application.
 * Creates sea-config-{name}.json with blob output path and settings.
 *
 * Configuration includes:
 * - Entry point (main file to bundle).
 * - Output blob path.
 * - Code cache enabled for optimization.
 * - Snapshot disabled for compatibility.
 * - No bundled assets (minimizes size).
 *
 * @param {string} entryPoint - Absolute path to the entry point file.
 * @param {string} outputPath - Absolute path to the output binary.
 * @returns Promise resolving to absolute path of generated config file.
 *
 * @example
 * const configPath = await generateSeaConfig(
 *   '/path/to/dist/cli.js',
 *   '/path/to/socket-darwin-arm64'
 * )
 * // Returns: /path/to/sea-config-socket-darwin-arm64.json
 */
export async function generateSeaConfig(entryPoint, outputPath) {
  const outputName = path.basename(outputPath, path.extname(outputPath))
  const configDir = path.dirname(outputPath)
  const configPath = normalizePath(
    path.join(configDir, `sea-config-${outputName}.json`),
  )
  // Use relative paths in sea-config.json (binject requires relative paths).
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
      checkIntervalSeconds: 86400,
      tagPrefix: 'socket-cli-',
      url: 'https://api.github.com/repos/SocketDev/socket-cli/releases',
    },
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return configPath
}
// c8 ignore stop

// =============================================================================
// Section 2: SEA Blob Generation (handled by binject).
// =============================================================================

// Blob generation is now handled automatically by binject when --sea points to
// a .json config file. The previous buildSeaBlob() function has been removed
// because binject can generate the blob using the target binary's Node.js version,
// which is critical for useCodeCache support (code cache is version-specific).
//
// This eliminates the Node.js version mismatch issue where we were using the host
// Node.js to generate blobs for node-smol targets with different Node.js versions.
//
// See injectSeaBlob() below for the config-based blob generation implementation.

// =============================================================================
// Section 3: Binary Injection.
// =============================================================================

/**
 * Inject SEA blob and optional VFS assets into a Node.js binary using binject.
 *
 * This function performs the core SEA binary build step by:
 * 1. Invoking binject to inject the SEA blob into the Node.js binary.
 * 2. Optionally embedding security tools via VFS compression (binject --vfs).
 *
 * Config-Based Blob Generation:
 * Instead of pre-generating the SEA blob with `node --experimental-sea-config`, binject
 * reads the sea-config.json directly and generates the blob automatically. This simplifies
 * the API and reduces build steps.
 *
 * VFS Compression (Optional):
 * If vfsTarGz is provided, binject's --vfs flag embeds the compressed tar.gz of security
 * tools into the binary. This achieves ~70% compression compared to Node.js SEA assets.
 * If vfsTarGz is omitted, --vfs-compat mode is used (no actual VFS bundling).
 *
 * @param {string} nodeBinary - Path to the node-smol binary to inject into.
 * @param {string} configPath - Path to the sea-config.json file for config-based blob generation.
 * @param {string} outputPath - Path to the output SEA binary (may be same as nodeBinary).
 * @param {string} cacheId - Unique cache identifier for parallel builds (prevents interference).
 * @param {string} [vfsTarGz] - Optional path to tar.gz file containing security tools for VFS bundling.
 *                              If provided, security tools are compressed and embedded in the binary.
 *                              If omitted, only the CLI code is bundled (no additional tools).
 * @returns Promise that resolves when injection completes.
 *
 * @example
 * await injectSeaBlob(
 *   'build-infra/build/downloaded/node-smol/darwin-arm64/node',
 *   'dist/sea/sea-config-socket-darwin-arm64.json',
 *   'dist/sea/socket-darwin-arm64',
 *   'socket-darwin-arm64-abc123',
 *   'build-infra/build/external-tools/darwin-arm64.tar.gz'
 * )
 * // Creates: dist/sea/socket-darwin-arm64 with CLI + compressed VFS
 *
 * @example
 * await injectSeaBlob(
 *   'build-infra/build/downloaded/node-smol/linux-x64/node',
 *   'dist/sea/sea-config-socket-linux-x64.json',
 *   'dist/sea/socket-linux-x64',
 *   'socket-linux-x64-abc123'
 * )
 * // Creates: dist/sea/socket-linux-x64 with CLI only (no VFS)
 */
export async function injectSeaBlob(
  nodeBinary,
  configPath,
  outputPath,
  cacheId,
  vfsTarGz,
) {
  // Get or download binject binary.
  let binjectVersion
  try {
    binjectVersion = await getLatestBinjectVersion()
  } catch (e) {
    // If we can't fetch the latest version, check if we have a cached version.
    const platform = process.platform
    const arch = process.arch
    // Detect actual libc on Linux (musl for Alpine, glibc for standard distros).
    const muslSuffix = detectMusl() ? '-musl' : ''
    const platformArch = `${platform}-${arch}${muslSuffix}`
    const rootPath = getRootPath()
    const binjectDir = normalizePath(
      path.join(
        rootPath,
        `packages/build-infra/build/downloaded/binject/${platformArch}`,
      ),
    )
    const versionPath = normalizePath(path.join(binjectDir, '.version'))

    if (existsSync(versionPath)) {
      const versionContent = (await fs.readFile(versionPath, 'utf8')).trim()
      if (!versionContent) {
        throw new Error(
          `Cached binject version file is empty at ${versionPath}. ` +
            'Please delete the cache directory and try again.',
          { cause: e },
        )
      }
      binjectVersion = versionContent
      logger.warn('Failed to fetch latest binject version from GitHub')
      logger.warn(`Using cached binject version ${binjectVersion}`)
    } else {
      throw new Error(
        `Failed to fetch binject version from GitHub and no cached version found: ${e.message}`,
        { cause: e },
      )
    }
  }

  const binjectPath = await downloadBinject(binjectVersion)

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
    result &&
    typeof result === 'object' &&
    'code' in result &&
    result.code !== 0
  ) {
    throw new Error(`binject failed with exit code ${result.code}`)
  }
}
