import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { PLATFORM_MAP_TOOLS } from '../constants/external-tools-platforms.mts'
import { externalTools, getRootPath, logger } from './external-tools-config.mts'
import { downloadAndInstallTool } from './external-tools-install.mts'

/**
 * Download and bundle security tools for socket-basics integration into SEA
 * binaries.
 *
 * Downloads platform-specific binaries of security scanning tools from their
 * respective GitHub releases, extracts them, and creates a compressed tar.gz
 * archive for VFS bundling. The resulting archive is used by binject's --vfs
 * flag to embed tools in the SEA binary with ~70% compression.
 *
 * Bundled Tools:
 *
 * - Python 3.11: Standalone Python runtime from Astral's python-build-standalone.
 * - Trivy v0.69.1: Container and filesystem vulnerability scanner from Aqua
 *   Security.
 * - TruffleHog v3.93.1: Secret and credential detection from Truffle Security.
 * - OpenGrep v1.16.0: SAST/code analysis engine (fork of Semgrep).
 *
 * Platform Coverage (8/8 platforms):
 *
 * - Darwin-arm64: All native ARM64.
 * - Darwin-x64: All native x86_64.
 * - Linux-arm64: All native ARM64 (glibc).
 * - Linux-arm64-musl: All native ARM64 (musl/Alpine).
 * - Linux-x64: All native x86_64 (glibc).
 * - Linux-x64-musl: All native x86_64 (musl/Alpine).
 * - Windows-x64: All native x86_64.
 * - Windows-arm64: Python and TruffleHog native ARM64, Trivy and OpenGrep x64
 *   emulated.
 *
 * Windows ARM64 Emulation: Windows 11 ARM64 has transparent x64 emulation, so
 * Trivy and OpenGrep (no native ARM64 builds available) use x64 binaries
 * without any code changes or special invocation.
 *
 * Compression Results:
 *
 * - Uncompressed tools: ~460 MB.
 * - Compressed tar.gz: ~140 MB (70% reduction).
 * - Final SEA binary: ~191 MB (includes Node.js base + CLI blob + compressed
 *   VFS).
 *
 * @example
 *   const tarGzPath = await downloadExternalTools('darwin', 'arm64')
 *   // Returns: '../build-infra/build/external-tools/darwin-arm64.tar.gz'
 *
 * @example
 *   const tarGzPath = await downloadExternalTools('linux', 'x64', true)
 *   // Returns: '../build-infra/build/external-tools/linux-x64-musl.tar.gz'
 *
 * @param {string} platform - Node.js platform identifier (darwin, linux,
 *   win32).
 * @param {string} arch - Node.js architecture identifier (arm64, x64).
 * @param {boolean} [isMusl=false] - Whether to use musl libc binaries for
 *   Linux.
 *
 * @returns Promise resolving to path of the generated tar.gz archive, or null
 *   if platform not supported.
 */
export async function downloadExternalTools(platform, arch, isMusl = false) {
  const rootPath = getRootPath()
  const muslSuffix = isMusl ? '-musl' : ''
  const platformArch = `${platform}-${arch}${muslSuffix}`

  const toolsDir = normalizePath(
    path.join(
      rootPath,
      `packages/build-infra/build/external-tools/${platformArch}`,
    ),
  )
  const tarGzPath = normalizePath(
    path.join(
      rootPath,
      `packages/build-infra/build/external-tools/${platformArch}.tar.gz`,
    ),
  )

  // Check if tar.gz already exists and is valid.
  if (existsSync(tarGzPath)) {
    // oxlint-disable-next-line socket/prefer-exists-sync -- reads .size for cache validation, not an existence check.
    const stats = await fs.stat(tarGzPath)

    // Validate cached file is not empty or suspiciously small (> 1KB).
    if (stats.size < 1024) {
      logger.warn(
        `Cached tar.gz is too small (${stats.size} bytes), rebuilding…`,
      )
      await safeDelete(tarGzPath)
    } else {
      logger.log(`External-tools tar.gz already exists: ${tarGzPath}`)
      return tarGzPath
    }
  }

  // Security tool versions and GitHub release info.
  // Versions are read from bundle-tools.json for centralized management.
  // Repository info is derived from the 'repository' field (format: owner/repo).
  const TOOL_REPOS = {
    __proto__: null,
  }

  // Populate TOOL_REPOS from bundle-tools.json.
  // Filter by release === 'asset' to include all GitHub-released tools.
  for (const [toolName, toolConfig] of Object.entries(externalTools)) {
    if (toolConfig.release === 'asset') {
      const repoPath = toolConfig.repository.replace(/^[^:]+:/, '')
      const parts = normalizePath(repoPath).split('/')
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid repository format for ${toolName}: expected '<host>:owner/repo', got '${toolConfig.repository}'`,
        )
      }
      const [owner, repo] = parts
      TOOL_REPOS[toolName] = {
        owner,
        repo,
        version: toolConfig.tag ?? toolConfig.version,
      }
    }
  }

  // Platform-specific binary mappings imported from centralized constant.
  // See scripts/constants/external-tools-platforms.mts for the full mapping.

  const toolsForPlatform = PLATFORM_MAP_TOOLS[platformArch]
  if (!toolsForPlatform) {
    logger.warn(`No external-tools available for platform: ${platformArch}`)
    return undefined
  }

  logger.log(`Downloading external-tools for ${platformArch}...`)
  await safeMkdir(toolsDir)

  // Download and extract each tool.
  const toolNames = []
  for (const [toolName, assetName] of Object.entries(toolsForPlatform)) {
    const config = TOOL_REPOS[toolName]

    // Validate tool exists in TOOL_REPOS (populated from bundle-tools.json).
    if (!config) {
      throw new Error(
        `Tool "${toolName}" is defined in platform mappings but not found in TOOL_REPOS. ` +
          `Ensure "${toolName}" exists in bundle-tools.json with release "asset".`,
      )
    }

    const installed = await downloadAndInstallTool(
      toolName,
      assetName,
      config,
      toolsDir,
      platform,
    )
    toolNames.push(...installed)
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

  if (tarResult && tarResult.code !== 0) {
    throw new Error('Failed to create external-tools tar.gz')
  }

  // oxlint-disable-next-line socket/prefer-exists-sync -- reads .size for the packaged-size log line, not an existence check.
  const tarStats = await fs.stat(tarGzPath)
  logger.success(
    `External-tools packaged: ${(tarStats.size / 1024 / 1024).toFixed(2)} MB`,
  )

  return tarGzPath
}
