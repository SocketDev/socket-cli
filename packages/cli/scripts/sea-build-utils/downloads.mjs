/**
 * @fileoverview Download utilities for SEA build assets.
 * Manages downloads of node-smol binaries, binject tool, and security tools from GitHub releases.
 *
 * Sections:
 * 1. Constants and Utilities - Shared configuration, auth, platform mappings.
 * 2. Node and Binject Downloads - Binary downloads for SEA injection.
 * 3. External Security Tools - Python, Trivy, TruffleHog, OpenGrep downloads.
 */

import { existsSync, readFileSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { downloadReleaseAsset } from 'build-infra/lib/github-releases'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { httpDownload, httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import { ARCH_MAP, PLATFORM_MAP } from '../constants/platform-mappings.mjs'
import { PLATFORM_MAP_TOOLS } from '../constants/external-tools-platforms.mjs'

// =============================================================================
// Section 1: Constants and Utilities.
// =============================================================================

/**
 * Default logger instance for SEA build operations.
 */
export const logger = getDefaultLogger()

/**
 * External tools configuration loaded from external-tools.json.
 * Contains version info, GitHub repos, and download metadata for security tools.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalToolsPath = path.join(__dirname, '../external-tools.json')
export const externalTools = JSON.parse(readFileSync(externalToolsPath, 'utf8'))

/**
 * Get GitHub API authentication headers.
 * Uses GH_TOKEN or GITHUB_TOKEN environment variables if available.
 *
 * @returns Headers object for GitHub API requests.
 */
export function getAuthHeaders() {
  const token = process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token && { Authorization: `Bearer ${token}` }),
  }
}

/**
 * Get the monorepo root path.
 * Resolves to socket-cli/ directory regardless of where script is run from.
 *
 * @returns Absolute path to monorepo root.
 */
export function getRootPath() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.join(__dirname, '../../../..')
}

// =============================================================================
// Section 2: Node and Binject Downloads (DEPRECATED - Moved to AssetManager).
// =============================================================================

/**
 * DEPRECATED: downloadNodeBinary and downloadBinject have been moved to AssetManager.
 *
 * Use the following instead:
 * - import { downloadNodeBinary } from '../utils/asset-manager-compat.mjs'
 * - import { downloadBinject } from '../utils/asset-manager-compat.mjs'
 *
 * These functions are now implemented in scripts/utils/asset-manager.mjs
 * with backward-compatible wrappers in scripts/utils/asset-manager-compat.mjs.
 *
 * The AssetManager provides unified binary download functionality with:
 * - Platform/arch normalization.
 * - Version caching and validation.
 * - GitHub API authentication.
 * - Local override support.
 */

/**
 * Get the latest binject release version from socket-btm.
 * Returns the version string (e.g., "1.0.0").
 *
 * @returns Promise resolving to binject version string.
 * @throws {Error} When socket-btm releases cannot be fetched.
 *
 * @example
 * const version = await getLatestBinjectVersion()
 * // "1.0.0"
 */
export async function getLatestBinjectVersion() {
  try {
    const response = await httpRequest(
      'https://api.github.com/repos/SocketDev/socket-btm/releases',
      {
        headers: getAuthHeaders(),
      },
    )

    if (!response.ok) {
      // Detect specific error types.
      if (response.status === 401) {
        throw new Error(
          'GitHub API authentication failed. Please check your GH_TOKEN or GITHUB_TOKEN environment variable.',
        )
      }

      if (response.status === 403) {
        const rateLimitReset = response.headers['x-ratelimit-reset']
        const resetTime = rateLimitReset
          ? new Date(Number(rateLimitReset) * 1_000).toLocaleString()
          : 'unknown'
        throw new Error(
          `GitHub API rate limit exceeded. Resets at: ${resetTime}. ` +
            'Set GH_TOKEN or GITHUB_TOKEN environment variable to increase rate limits ' +
            '(unauthenticated: 60/hour, authenticated: 5,000/hour).',
        )
      }

      throw new Error(
        `Failed to fetch socket-btm releases: ${response.status} ${response.statusText}`,
      )
    }

    const releases = JSON.parse(response.body.toString('utf8'))

    // Validate API response structure.
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error(
        'Invalid API response: expected non-empty array of releases',
      )
    }

    // Find the latest binject release.
    const binjectRelease = releases.find(release =>
      release?.tag_name?.startsWith('binject-'),
    )

    if (!binjectRelease) {
      throw new Error('No binject release found in socket-btm')
    }

    if (!binjectRelease.tag_name) {
      throw new Error('Invalid release data: missing tag_name')
    }

    // Extract the version (e.g., "binject-1.0.0" -> "1.0.0").
    return binjectRelease.tag_name.replace('binject-', '')
  } catch (e) {
    throw new Error('Failed to fetch latest socket-btm binject release', {
      cause: e,
    })
  }
}

// =============================================================================
// Section 3: External Security Tools Downloads.
// =============================================================================

/**
 * Download and bundle security tools for socket-basics integration into SEA binaries.
 *
 * Downloads platform-specific binaries of security scanning tools from their respective
 * GitHub releases, extracts them, and creates a compressed tar.gz archive for VFS bundling.
 * The resulting archive is used by binject's --vfs flag to embed tools in the SEA binary
 * with ~70% compression.
 *
 * Bundled Tools:
 * - Python 3.11: Standalone Python runtime from Astral's python-build-standalone.
 * - Trivy v0.69.1: Container and filesystem vulnerability scanner from Aqua Security.
 * - TruffleHog v3.93.1: Secret and credential detection from Truffle Security.
 * - OpenGrep v1.16.0: SAST/code analysis engine (fork of Semgrep).
 *
 * Platform Coverage (8/8 platforms):
 * - darwin-arm64: All native ARM64.
 * - darwin-x64: All native x86_64.
 * - linux-arm64: All native ARM64 (glibc).
 * - linux-arm64-musl: All native ARM64 (musl/Alpine).
 * - linux-x64: All native x86_64 (glibc).
 * - linux-x64-musl: All native x86_64 (musl/Alpine).
 * - windows-x64: All native x86_64.
 * - windows-arm64: Python and TruffleHog native ARM64, Trivy and OpenGrep x64 emulated.
 *
 * Windows ARM64 Emulation:
 * Windows 11 ARM64 has transparent x64 emulation, so Trivy and OpenGrep (no native ARM64
 * builds available) use x64 binaries without any code changes or special invocation.
 *
 * Compression Results:
 * - Uncompressed tools: ~460 MB.
 * - Compressed tar.gz: ~140 MB (70% reduction).
 * - Final SEA binary: ~191 MB (includes Node.js base + CLI blob + compressed VFS).
 *
 * @param {string} platform - Node.js platform identifier (darwin, linux, win32).
 * @param {string} arch - Node.js architecture identifier (arm64, x64).
 * @param {boolean} [isMusl=false] - Whether to use musl libc binaries for Linux.
 * @returns Promise resolving to path of the generated tar.gz archive, or null if platform not supported.
 *
 * @example
 * const tarGzPath = await downloadExternalTools('darwin', 'arm64')
 * // Returns: '../build-infra/build/security-tools/darwin-arm64.tar.gz'
 *
 * @example
 * const tarGzPath = await downloadExternalTools('linux', 'x64', true)
 * // Returns: '../build-infra/build/security-tools/linux-x64-musl.tar.gz'
 */
export async function downloadExternalTools(platform, arch, isMusl = false) {
  const rootPath = getRootPath()
  const muslSuffix = isMusl ? '-musl' : ''
  const platformArch = `${platform}-${arch}${muslSuffix}`

  const toolsDir = normalizePath(
    path.join(rootPath, `../build-infra/build/security-tools/${platformArch}`),
  )
  const tarGzPath = normalizePath(
    path.join(
      rootPath,
      `../build-infra/build/security-tools/${platformArch}.tar.gz`,
    ),
  )

  // Check if tar.gz already exists and is valid.
  if (existsSync(tarGzPath)) {
    const stats = await fs.stat(tarGzPath)

    // Validate cached file is not empty or suspiciously small (> 1KB).
    if (stats.size < 1024) {
      logger.warn(
        `Cached tar.gz is too small (${stats.size} bytes), rebuilding...`,
      )
      await fs.rm(tarGzPath, { force: true })
    } else {
      logger.log(`Security tools tar.gz already exists: ${tarGzPath}`)
      return tarGzPath
    }
  }

  // Security tool versions and GitHub release info.
  // Versions are read from external-tools.json for centralized management.
  // Repository info is derived from the 'repository' field (format: owner/repo).
  const TOOL_REPOS = {
    __proto__: null,
  }

  // Populate TOOL_REPOS from external-tools.json.
  // Filter by type === 'github-release' to include all GitHub-released tools.
  for (const [toolName, toolConfig] of Object.entries(externalTools)) {
    if (toolConfig.type === 'github-release') {
      const [owner, repo] = toolConfig.repository.split('/')
      TOOL_REPOS[toolName] = {
        owner,
        repo,
        // Python uses buildTag for version, others use version field.
        version:
          toolName === 'python' ? toolConfig.buildTag : toolConfig.version,
      }
    }
  }

  // Platform-specific binary mappings imported from centralized constant.
  // See scripts/constants/external-tools-platforms.mjs for the full mapping.

  const toolsForPlatform = PLATFORM_MAP_TOOLS[platformArch]
  if (!toolsForPlatform) {
    logger.warn(`No security tools available for platform: ${platformArch}`)
    return null
  }

  logger.log(`Downloading security tools for ${platformArch}...`)
  await safeMkdir(toolsDir)

  // Download and extract each tool.
  const toolNames = []
  for (const [toolName, assetName] of Object.entries(toolsForPlatform)) {
    const config = TOOL_REPOS[toolName]
    const isPlatWin = platform === 'win32'
    const binaryName = toolName + (isPlatWin ? '.exe' : '')
    const binaryPath = normalizePath(path.join(toolsDir, binaryName))

    // Skip if already downloaded.
    if (
      existsSync(binaryPath) ||
      (toolName === 'python' && existsSync(path.join(toolsDir, 'python')))
    ) {
      logger.log(`  ✓ ${toolName} already downloaded`)
      toolNames.push(toolName === 'python' ? 'python' : binaryName)
      continue
    }

    logger.log(`  Downloading ${toolName}...`)
    const archivePath = normalizePath(path.join(toolsDir, assetName))

    // Download archive directly from GitHub releases.
    // Python uses date-based tags without 'v' prefix.
    const tag = toolName === 'python' ? config.version : config.version
    const url = `https://github.com/${config.owner}/${config.repo}/releases/download/${tag}/${assetName}`
    await httpDownload(url, archivePath, {
      logger,
      progressInterval: 10,
      retries: 2,
      retryDelay: 5000,
    })

    // Extract binary.
    logger.log(`  Extracting ${toolName}...`)
    const isZip = assetName.endsWith('.zip')

    if (isZip) {
      // Use unzip command.
      const unzipResult = await spawn('unzip', [
        '-q',
        '-o',
        archivePath,
        '-d',
        toolsDir,
      ])
      if (unzipResult && unzipResult.exitCode !== 0) {
        throw new Error(`Failed to extract ${assetName}`)
      }
    } else {
      // Use tar command.
      const tarResult = await spawn('tar', [
        '-xzf',
        archivePath,
        '-C',
        toolsDir,
      ])
      if (tarResult && tarResult.exitCode !== 0) {
        throw new Error(`Failed to extract ${assetName}`)
      }
    }

    // Find and move binary to final location.
    let extractedBinaryPath

    if (toolName === 'python') {
      // Python extracts to python/bin/python (symlink to python3.11).
      // Unlike other tools, Python requires its entire directory structure (stdlib, lib,
      // include directories) to function. The python-build-standalone package is a
      // complete, self-contained Python installation (~19 MB compressed).
      //
      // Directory structure after extraction:
      // python/
      // ├── bin/           # Python executable and symlinks.
      // ├── lib/           # Standard library and site-packages.
      // ├── include/       # C headers for extension modules.
      // └── share/         # Documentation and other resources.
      //
      // We keep the entire python/ directory in the VFS for socket-basics to use.
      const pythonBinPath = normalizePath(
        path.join(
          toolsDir,
          'python',
          'bin',
          isPlatWin ? 'python.exe' : 'python',
        ),
      )

      // Verify Python installation is complete.
      if (!existsSync(pythonBinPath)) {
        throw new Error(
          `Python binary not found after extraction: ${pythonBinPath}`,
        )
      }

      // Make all binaries executable on Unix (python, python3, python3.11, etc.).
      if (!isPlatWin) {
        const binDir = path.join(toolsDir, 'python', 'bin')
        const binFiles = await fs.readdir(binDir)
        for (const file of binFiles) {
          const filePath = path.join(binDir, file)
          const stats = await fs.lstat(filePath)
          if (stats.isFile()) {
            await fs.chmod(filePath, 0o755)
          }
        }
      }

      // Don't clean up - keep the whole python directory.
      // We'll include the entire directory in the tar.gz.
      toolNames.push('python')
    } else if (toolName === 'opengrep') {
      // OpenGrep binary is named opengrep-core in the archive.
      extractedBinaryPath = normalizePath(
        path.join(toolsDir, `opengrep-core${isPlatWin ? '.exe' : ''}`),
      )

      if (
        extractedBinaryPath !== binaryPath &&
        existsSync(extractedBinaryPath)
      ) {
        await fs.rename(extractedBinaryPath, binaryPath)
      } else if (!existsSync(binaryPath)) {
        throw new Error(
          `Binary not found after extraction: ${extractedBinaryPath}`,
        )
      }

      // Make executable on Unix.
      if (!isPlatWin) {
        await fs.chmod(binaryPath, 0o755)
      }

      toolNames.push(binaryName)
    } else {
      // Other tools extract with their own name.
      extractedBinaryPath = normalizePath(
        path.join(toolsDir, toolName + (isPlatWin ? '.exe' : '')),
      )

      if (
        extractedBinaryPath !== binaryPath &&
        existsSync(extractedBinaryPath)
      ) {
        await fs.rename(extractedBinaryPath, binaryPath)
      } else if (!existsSync(binaryPath)) {
        throw new Error(
          `Binary not found after extraction: ${extractedBinaryPath}`,
        )
      }

      // Make executable on Unix.
      if (!isPlatWin) {
        await fs.chmod(binaryPath, 0o755)
      }

      toolNames.push(binaryName)
    }

    // Clean up archive.
    await safeDelete(archivePath)

    logger.log(`  ✓ ${toolName} ready`)
  }

  // Package into compressed tar.gz.
  logger.log(`Creating compressed tar.gz: ${path.basename(tarGzPath)}`)
  const tarResult = await spawn('tar', [
    '-czf',
    tarGzPath,
    '-C',
    toolsDir,
    ...toolNames,
  ])

  if (tarResult && tarResult.exitCode !== 0) {
    throw new Error('Failed to create security tools tar.gz')
  }

  const tarStats = await fs.stat(tarGzPath)
  logger.log(
    `✓ Security tools packaged: ${(tarStats.size / 1_024 / 1_024).toFixed(2)} MB`,
  )

  return tarGzPath
}
