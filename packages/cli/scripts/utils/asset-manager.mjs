/**
 * @fileoverview Unified asset manager for socket-btm releases.
 * Consolidates download functionality from download-assets.mjs and sea-build-utils/downloads.mjs.
 *
 * This module provides:
 * - Unified binary downloads (node-smol, binject)
 * - Version caching and validation
 * - Platform/arch normalization
 * - GitHub API authentication
 *
 * Phase 1 (Foundation): Core class implementation without migration.
 * Existing download functions remain unchanged for backward compatibility.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { downloadReleaseAsset } from 'build-infra/lib/github-releases'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { ARCH_MAP, PLATFORM_MAP } from '../constants/platform-mappings.mjs'

// =============================================================================
// Constants and Utilities.
// =============================================================================

/**
 * Get the monorepo root path.
 *
 * @returns Absolute path to monorepo root.
 */
function getRootPath() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.join(__dirname, '../../../..')
}

// =============================================================================
// AssetManager Class.
// =============================================================================

/**
 * Unified asset manager for downloading and caching socket-btm releases.
 *
 * @example
 * const manager = new AssetManager()
 * const nodePath = await manager.downloadBinary({
 *   tool: 'node-smol',
 *   version: '20251213-7cf90d2',
 *   platform: 'darwin',
 *   arch: 'arm64'
 * })
 */
export class AssetManager {
  /**
   * Create a new AssetManager instance.
   *
   * @param {Object} [options] - Configuration options.
   * @param {string} [options.downloadDir] - Base directory for downloads (default: build-infra/build/downloaded).
   * @param {boolean} [options.quiet] - Suppress logs (default: false).
   * @param {boolean} [options.cacheEnabled] - Enable version caching (default: true).
   */
  constructor(options = {}) {
    const { cacheEnabled = true, downloadDir, quiet = false } = {
      __proto__: null,
      ...options,
    }

    this.cacheEnabled = cacheEnabled
    this.logger = getDefaultLogger()
    this.quiet = quiet

    // Default download directory: socket-cli/packages/build-infra/build/downloaded/
    const rootPath = getRootPath()
    this.downloadDir =
      downloadDir ||
      normalizePath(path.join(rootPath, '../build-infra/build/downloaded'))
  }

  /**
   * Get GitHub API authentication headers.
   * Uses GH_TOKEN or GITHUB_TOKEN environment variables if available.
   *
   * @returns {Object} Headers object for GitHub API requests.
   */
  getAuthHeaders() {
    const token = process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token && { Authorization: `Bearer ${token}` }),
    }
  }

  /**
   * Get platform-arch identifier with optional libc suffix.
   *
   * @param {string} platform - Platform identifier (darwin, linux, win32).
   * @param {string} arch - Architecture identifier (arm64, x64, ia32).
   * @param {string} [libc] - Linux libc variant ('musl' for Alpine).
   * @returns {string} Platform-arch identifier (e.g., 'darwin-arm64', 'linux-x64-musl').
   */
  getPlatformArch(platform, arch, libc) {
    const muslSuffix = libc === 'musl' ? '-musl' : ''
    return `${platform}-${arch}${muslSuffix}`
  }

  /**
   * Get download directory for a specific tool and platform.
   *
   * @param {string} tool - Tool name (node-smol, binject).
   * @param {string} platformArch - Platform-arch identifier.
   * @returns {string} Absolute path to download directory.
   */
  getDownloadDir(tool, platformArch) {
    return normalizePath(path.join(this.downloadDir, tool, platformArch))
  }

  /**
   * Validate cached version matches expected tag.
   * Checks .version file content and returns true if valid.
   *
   * @param {string} versionPath - Path to .version file.
   * @param {string} expectedTag - Expected version tag.
   * @param {string} tagPrefix - Required tag prefix for validation (e.g., 'node-smol-').
   * @returns {Promise<boolean>} True if cache is valid.
   */
  async validateCache(versionPath, expectedTag, tagPrefix) {
    if (!existsSync(versionPath)) {
      return false
    }

    const content = (await fs.readFile(versionPath, 'utf8')).trim()

    // Validate version format to prevent empty/corrupted version files.
    if (!content || content.length === 0) {
      this.logger.warn(`Invalid version file at ${versionPath}, clearing cache`)
      return false
    }

    // Validate tag prefix if provided.
    if (tagPrefix && !content.startsWith(tagPrefix)) {
      this.logger.warn(`Invalid version file at ${versionPath}, clearing cache`)
      return false
    }

    return content === expectedTag
  }

  /**
   * Clear stale cache directory with verification.
   *
   * @param {string} cacheDir - Directory to clear.
   * @returns {Promise<void>}
   */
  async clearStaleCache(cacheDir) {
    if (!existsSync(cacheDir)) {
      return
    }

    this.logger.log('Clearing stale cache...')

    try {
      await safeDelete(cacheDir)

      // Verify deletion succeeded.
      if (existsSync(cacheDir)) {
        throw new Error(`Failed to clear cache directory: ${cacheDir}`)
      }
    } catch (e) {
      this.logger.error(`Cache clear failed: ${e.message}`)
      throw new Error(
        `Cannot clear stale cache at ${cacheDir}. ` +
          'Please delete manually or use local override environment variables.',
      )
    }
  }

  /**
   * Download a binary asset (node-smol or binject).
   *
   * @param {Object} config - Download configuration.
   * @param {string} config.tool - Tool name ('node-smol' or 'binject').
   * @param {string} config.version - Version tag suffix (e.g., '20251213-7cf90d2').
   * @param {string} config.platform - Platform identifier (darwin, linux, win32).
   * @param {string} config.arch - Architecture identifier (arm64, x64).
   * @param {string} [config.libc] - Linux libc variant ('musl' for Alpine).
   * @param {string} [config.localOverride] - Environment variable name for local file override.
   * @returns {Promise<string>} Absolute path to downloaded binary.
   */
  async downloadBinary(config) {
    const { arch, libc, localOverride, platform, tool, version } = {
      __proto__: null,
      ...config,
    }

    // Check for local override environment variable.
    if (localOverride) {
      const localPath = process.env[localOverride]
      if (localPath && existsSync(localPath)) {
        this.logger.log(`Using local ${tool} from: ${localPath}`)
        return localPath
      }

      if (localPath && !existsSync(localPath)) {
        this.logger.warn(
          `${localOverride} is set but file not found: ${localPath}`,
        )
        this.logger.warn(`Falling back to downloaded ${tool} from GitHub releases`)
      }
    }

    const isPlatWin = platform === 'win32'
    const platformArch = this.getPlatformArch(platform, arch, libc)
    const toolDir = this.getDownloadDir(tool, platformArch)

    // Determine binary filename based on platform.
    const isNodeSmol = tool === 'node-smol'
    const binaryName = isNodeSmol ? 'node' : tool
    const binaryFilename = isPlatWin ? `${binaryName}.exe` : binaryName
    const binaryPath = normalizePath(path.join(toolDir, binaryFilename))
    const versionPath = normalizePath(path.join(toolDir, '.version'))

    // Build full tag (e.g., 'node-smol-20251213-7cf90d2').
    const tag = `${tool}-${version}`

    // Check if cached version matches requested version.
    const tagPrefix = `${tool}-`
    const cacheValid = await this.validateCache(versionPath, tag, tagPrefix)

    if (cacheValid && existsSync(binaryPath)) {
      return binaryPath
    }

    // Clear stale cache if it exists.
    if (existsSync(toolDir)) {
      await this.clearStaleCache(toolDir)
    }

    // Map platform/arch to socket-btm release asset names.
    const mappedPlatform = PLATFORM_MAP[platform]
    const mappedArch = ARCH_MAP[arch]

    if (!mappedPlatform || !mappedArch) {
      throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
    }

    // Build asset filename.
    // Format: {tool}-{platform}-{arch}[-musl][.exe]
    const muslSuffix = libc === 'musl' ? '-musl' : ''
    const assetFilename = `${binaryName}-${mappedPlatform}-${mappedArch}${muslSuffix}${isPlatWin ? '.exe' : ''}`

    this.logger.log(`Downloading ${tool} from socket-btm ${tag}...`)

    // Ensure target directory exists.
    await safeMkdir(toolDir)

    // Download using github-releases helper (handles HTTP 302 redirects automatically).
    await downloadReleaseAsset(tag, assetFilename, binaryPath)

    // Write version file (store full tag for consistency).
    await fs.writeFile(versionPath, tag, 'utf8')

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(binaryPath, 0o755)
    }

    return binaryPath
  }
}
