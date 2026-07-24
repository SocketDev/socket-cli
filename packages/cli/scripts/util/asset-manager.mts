/**
 * @file Unified asset manager for SEA base assets. Consolidates download
 *   functionality from download-assets.mts and sea-build-utils/downloads.mts.
 *   This module provides:
 *
 *   - Unified binary downloads (node-smol, binject) from the socket-cli
 *     base-assets mirror releases with SHA-256 verification, falling back to
 *     the descoped socket-btm source releases for one transition release
 *   - Version caching and validation
 *   - Platform/arch normalization
 *   - GitHub API authentication Phase 1 (Foundation): Core class implementation
 *     without migration. Existing download functions remain unchanged for
 *     backward compatibility.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logTransientErrorHelp } from 'build-infra/lib/github-error-utils'
import { downloadReleaseAsset } from 'build-infra/lib/github-releases'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  BASE_ASSET_SHA256,
  BASE_ASSETS_FALLBACK_OWNER,
  BASE_ASSETS_FALLBACK_REPO,
  BASE_ASSETS_MIRROR_OWNER,
  BASE_ASSETS_MIRROR_REPO,
} from '../constants/base-assets.mts'
import { ARCH_MAP, PLATFORM_MAP } from '../constants/platform-mappings.mts'
import { computeFileHash } from './socket-btm-releases.mts'

// =============================================================================
// Constants and Utilities.
// =============================================================================

/**
 * Get the monorepo root path.
 *
 * @returns Absolute path to monorepo root.
 */
export function getRootPath() {
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
 *   const manager = new AssetManager()
 *   const nodePath = await manager.downloadBinary({
 *     tool: 'node-smol',
 *     version: '20251213-7cf90d2',
 *     platform: 'darwin',
 *     arch: 'arm64',
 *   })
 */
export class AssetManager {
  /**
   * Create a new AssetManager instance.
   *
   * @param {Object} [options] - Configuration options.
   * @param {string} [options.downloadDir] - Base directory for downloads
   *   (default: build-infra/build/downloaded).
   * @param {boolean} [options.quiet] - Suppress logs (default: false).
   * @param {boolean} [options.cacheEnabled] - Enable version caching (default:
   *   true).
   */
  constructor(options = {}) {
    const {
      cacheEnabled = true,
      downloadDir,
      quiet = false,
    } = {
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
      normalizePath(
        path.join(rootPath, 'packages/build-infra/build/downloaded'),
      )
  }

  /**
   * Get GitHub API authentication headers. Uses GH_TOKEN or GITHUB_TOKEN
   * environment variables if available.
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
   *
   * @returns {string} Platform-arch identifier (e.g., 'darwin-arm64',
   *   'linux-x64-musl').
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
   *
   * @returns {string} Absolute path to download directory.
   */
  getDownloadDir(tool, platformArch) {
    return normalizePath(path.join(this.downloadDir, tool, platformArch))
  }

  /**
   * Validate cached version matches expected tag. Checks .version file content
   * and returns true if valid.
   *
   * @param {string} versionPath - Path to .version file.
   * @param {string} expectedTag - Expected version tag.
   * @param {string} tagPrefix - Required tag prefix for validation (e.g.,
   *   'node-smol-').
   *
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
   *
   * @returns {Promise<void>}
   */
  async clearStaleCache(cacheDir) {
    if (!existsSync(cacheDir)) {
      return
    }

    this.logger.log('Clearing stale cache…')

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
   * @param {string} config.version - Version tag suffix (e.g.,
   *   '20251213-7cf90d2').
   * @param {string} config.platform - Platform identifier (darwin, linux,
   *   win32).
   * @param {string} config.arch - Architecture identifier (arm64, x64).
   * @param {string} [config.libc] - Linux libc variant ('musl' for Alpine).
   * @param {string} [config.localOverride] - Environment variable name for
   *   local file override.
   *
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
        this.logger.warn(
          `Falling back to downloaded ${tool} from GitHub releases`,
        )
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

    // Create lock file to prevent concurrent downloads (TOCTOU mitigation).
    const lockFile = normalizePath(path.join(toolDir, '.downloading'))

    await safeMkdir(toolDir)

    try {
      // Try to create lock file atomically (wx = write + exclusive).
      await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
    } catch (e) {
      if (e.code === 'EEXIST') {
        // Another process is downloading, wait and check for completion.
        this.logger.log(`Another process is downloading ${tool}, waiting…`)
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => {
            setTimeout(resolve, 1000)
          })
          // Check if cached version matches requested version.
          const tagPrefix = `${tool}-`
          const cacheValid = await this.validateCache(
            versionPath,
            tag,
            tagPrefix,
          )
          if (cacheValid && existsSync(binaryPath)) {
            return binaryPath
          }
        }
        throw new Error(
          `Timeout waiting for another process to download ${tool}`,
        )
      }
      throw e
    }

    try {
      // Check if cached version matches requested version.
      const tagPrefix = `${tool}-`
      const cacheValid = await this.validateCache(versionPath, tag, tagPrefix)

      if (cacheValid && existsSync(binaryPath)) {
        return binaryPath
      }

      // Clear stale cache if it exists.
      if (existsSync(toolDir)) {
        // Remove version file and binary, but keep lock file.
        if (existsSync(versionPath)) {
          await safeDelete(versionPath)
        }
        if (existsSync(binaryPath)) {
          await safeDelete(binaryPath)
        }
      }

      // Map platform/arch to release asset names. node-smol assets use the
      // shortened platform names ('win'); binject assets keep the raw Node.js
      // platform identifiers ('win32').
      const mappedPlatform = isNodeSmol ? PLATFORM_MAP[platform] : platform
      const mappedArch = ARCH_MAP[arch]

      if (!mappedPlatform || !mappedArch) {
        throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
      }

      // Build asset filename.
      // Format: {tool}-{platform}-{arch}[-musl][.exe]
      const muslSuffix = libc === 'musl' ? '-musl' : ''
      const assetFilename = `${binaryName}-${mappedPlatform}-${mappedArch}${muslSuffix}${isPlatWin ? '.exe' : ''}`

      // Frozen tool tags are mirrored into socket-cli base-assets-* releases
      // with checked-in SHA-256 pins. Anything else (e.g. a custom
      // SOCKET_CLI_SEA_NODE_VERSION) has no pin and only exists on socket-btm.
      const pinnedSha256 = BASE_ASSET_SHA256[tag]?.[assetFilename]

      // Download using github-releases helper (handles HTTP 302 redirects automatically).
      try {
        if (pinnedSha256) {
          const mirrorTag = `base-assets-${tag}`
          this.logger.log(
            `Downloading ${tool} from ${BASE_ASSETS_MIRROR_REPO} ${mirrorTag}...`,
          )
          try {
            await downloadReleaseAsset(
              BASE_ASSETS_MIRROR_OWNER,
              BASE_ASSETS_MIRROR_REPO,
              mirrorTag,
              assetFilename,
              binaryPath,
            )
          } catch (mirrorError) {
            // TRANSITION FALLBACK: socket-btm is descoped but still serves the
            // frozen source releases. Keep for one transition release, then
            // remove once the socket-cli mirror has proven itself.
            this.logger.warn(
              `Mirror download failed (${mirrorError.message}), ` +
                `falling back to ${BASE_ASSETS_FALLBACK_REPO} ${tag}...`,
            )
            await downloadReleaseAsset(
              BASE_ASSETS_FALLBACK_OWNER,
              BASE_ASSETS_FALLBACK_REPO,
              tag,
              assetFilename,
              binaryPath,
            )
          }
        } else {
          this.logger.warn(
            `No SHA-256 pin for ${tag}/${assetFilename} — downloading unverified from ${BASE_ASSETS_FALLBACK_REPO}...`,
          )
          await downloadReleaseAsset(
            BASE_ASSETS_FALLBACK_OWNER,
            BASE_ASSETS_FALLBACK_REPO,
            tag,
            assetFilename,
            binaryPath,
          )
        }
      } catch (e) {
        await logTransientErrorHelp(e)
        throw e
      }

      // Verify the download against the checked-in pin regardless of which
      // home served it.
      if (pinnedSha256) {
        const actualSha256 = await computeFileHash(binaryPath)
        if (actualSha256 !== pinnedSha256) {
          await safeDelete(binaryPath)
          throw new Error(
            `SHA-256 mismatch for ${assetFilename} (${tag}): ` +
              `expected ${pinnedSha256}, got ${actualSha256}`,
          )
        }
      }

      // Write version file (store full tag for consistency).
      await fs.writeFile(versionPath, tag, 'utf8')

      // Make executable on Unix.
      if (!isPlatWin) {
        await fs.chmod(binaryPath, 0o755)
      }

      return binaryPath
    } finally {
      // Clean up lock file.
      try {
        if (existsSync(lockFile)) {
          await safeDelete(lockFile)
        }
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
