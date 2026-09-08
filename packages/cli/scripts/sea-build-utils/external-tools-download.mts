import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { PLATFORM_MAP_TOOLS } from '../constants/external-tools-platforms.mts'
import { externalTools, getRootPath, logger } from './external-tools-config.mts'
import { downloadAndInstallTool } from './external-tools-install.mts'

function collectToolRepositories() {
  // Security tool versions and GitHub release info.
  // Versions are read from bundle-tools.json for centralized management.
  // Repository info is derived from the 'repository' field (format: owner/repo).
  const TOOL_REPOS = {
    __proto__: null,
  }

  // Populate TOOL_REPOS from bundle-tools.json.
  // Filter by origin === 'gh-asset' to include all GitHub-released tools.
  for (const [toolName, toolConfig] of Object.entries(externalTools)) {
    if (toolConfig.origin === 'gh-asset') {
      const repoPath = toolConfig.repository.replace(/^[^:]+:/, '')
      const parts = normalizePath(repoPath).split('/')
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid repository format for ${toolName}: expected '<host>:owner/repo', got '${toolConfig.repository}'`,
        )
      }
      const { 0: owner, 1: repo } = parts
      TOOL_REPOS[toolName] = {
        owner,
        repo,
        version: toolConfig.tag ?? toolConfig.version,
      }
    }
  }

  return TOOL_REPOS
}

/**
 * Download the configured platform tools and package them for SEA VFS bundling.
 * Reuse a cached archive when it passes the size check.
 * Return the archive path, or undefined for an unsupported platform.
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
    // reads .size for cache validation, not an existence check.
    // oxlint-disable-next-line socket/prefer-exists-sync -- reads .size
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

  const TOOL_REPOS = collectToolRepositories()

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
          `Ensure "${toolName}" exists in bundle-tools.json with origin "gh-asset".`,
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

  // reads .size for the packaged-size log line, not an existence check.
  // oxlint-disable-next-line socket/prefer-exists-sync -- reads .size
  const tarStats = await fs.stat(tarGzPath)
  logger.success(
    `External-tools packaged: ${(tarStats.size / 1024 / 1024).toFixed(2)} MB`,
  )

  return tarGzPath
}
