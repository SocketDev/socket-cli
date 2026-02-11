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

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import {
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
  const configPath = normalizePath(
    path.join(path.dirname(outputPath), `sea-config-${outputName}.json`),
  )
  const blobPath = normalizePath(
    path.join(path.dirname(outputPath), `sea-blob-${outputName}.blob`),
  )

  const config = {
    // No assets to minimize size.
    assets: {},
    disableExperimentalSEAWarning: true,
    main: entryPoint,
    output: blobPath,
    // Enable code cache for optimization.
    useCodeCache: true,
    // Disable for compatibility.
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
// Section 2: SEA Blob Generation.
// =============================================================================

/**
 * Build SEA blob from configuration file.
 * Uses the current Node.js process instead of the target binary to avoid issues
 * with cross-platform builds and potentially corrupted downloaded binaries.
 *
 * The blob format is platform-independent, so we can safely use the host Node.js
 * process to generate blobs for any target platform. This approach:
 * 1. Enables cross-platform builds (e.g., building Windows binary on macOS).
 * 2. Avoids issues with downloaded node-smol binaries that may not run on host.
 * 3. Uses the most reliable Node.js binary available (current process).
 *
 * @param {string} configPath - Absolute path to sea-config.json file.
 * @returns Promise resolving to absolute path of generated blob file.
 *
 * @example
 * const blobPath = await buildSeaBlob('dist/sea/sea-config-socket-darwin-arm64.json')
 * // Returns: dist/sea/sea-blob-socket-darwin-arm64.blob
 */
// c8 ignore start - Requires spawning node binary with experimental SEA config.
export async function buildSeaBlob(configPath) {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const blobPath = config.output

  // Generate the blob using the current Node.js process.
  // We use process.execPath (the current Node) instead of the target binary because:
  // 1. The blob format is platform-independent.
  // 2. Downloaded node-smol binaries may have issues running on the host system.
  // 3. Cross-platform builds wouldn't work (e.g., building Windows binary on macOS).
  const spawnPromise = spawn(
    process.execPath,
    ['--experimental-sea-config', configPath],
    { stdio: 'inherit' },
  )

  const result = await spawnPromise
  if (
    result &&
    typeof result === 'object' &&
    'exitCode' in result &&
    result.exitCode !== 0
  ) {
    throw new Error(`Failed to generate SEA blob: exit code ${result.exitCode}`)
  }

  return blobPath
}
// c8 ignore stop

// =============================================================================
// Section 3: Binary Injection.
// =============================================================================

/**
 * Inject SEA blob and optional VFS assets into a Node.js binary using binject.
 *
 * This function performs the core SEA binary build step by:
 * 1. Generating an update-config.json for embedded update checking (binject --update-config).
 * 2. Invoking binject to inject the SEA blob into the Node.js binary.
 * 3. Optionally embedding security tools via VFS compression (binject --vfs).
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
 * Update Config Embedding:
 * The function generates an update-config.json that node-smol's C stub uses for built-in
 * update checking. This enables SEA binaries to check GitHub releases and notify users of
 * available updates without needing TypeScript-based update checking.
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
 *   'build-infra/build/security-tools/darwin-arm64.tar.gz'
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
    const muslSuffix = platform === 'linux' ? '-musl' : ''
    const platformArch = `${platform}-${arch}${muslSuffix}`
    const rootPath = getRootPath()
    const binjectDir = normalizePath(
      path.join(
        rootPath,
        `../build-infra/build/downloaded/binject/${platformArch}`,
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

  // Generate update-config.json for embedded update checking.
  const updateConfigPath = normalizePath(
    path.join(path.dirname(configPath), 'update-config.json'),
  )
  const updateConfig = {
    binname: 'socket',
    command: 'self-update',
    interval: 86_400_000,
    notify_interval: 86_400_000,
    prompt: false,
    prompt_default: 'n',
    skip_env: 'SOCKET_SKIP_UPDATE_CHECK',
    tag: 'socket-cli-*',
    url: 'https://api.github.com/repos/SocketDev/socket-cli/releases',
  }
  await fs.writeFile(updateConfigPath, JSON.stringify(updateConfig, null, 2))

  try {
    // Inject SEA blob into Node binary using binject.
    //
    // Config-Based Blob Generation:
    // When --sea points to a .json file (sea-config.json), binject reads the config
    // and generates the blob automatically. This is more efficient than pre-generating
    // with `node --experimental-sea-config`.
    //
    // VFS Compression:
    // If vfsTarGz is provided, we use --vfs to embed compressed security tools.
    // binject decompresses the tar.gz and injects the files into the binary's VFS.
    // This achieves ~70% compression (460 MB → 140 MB for security tools).
    //
    // Without VFS (vfs-compat mode):
    // If vfsTarGz is omitted, --vfs-compat mode is used, which injects only the SEA
    // blob without any additional VFS data. This is useful for minimal CLI-only builds.
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

    args.push('--update-config', updateConfigPath)

    const result = await spawn(binjectPath, args, { env, stdio: 'inherit' })

    if (
      result &&
      typeof result === 'object' &&
      'exitCode' in result &&
      result.exitCode !== 0
    ) {
      throw new Error(`binject failed with exit code ${result.exitCode}`)
    }
  } finally {
    // Clean up update config file (keep in debug mode for troubleshooting).
    if (!process.env['DEBUG']) {
      await safeDelete(updateConfigPath).catch(() => {})
    }
  }
}
