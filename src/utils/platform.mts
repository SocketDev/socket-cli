/**
 * Platform-specific utilities for Socket CLI.
 * Provides cross-platform file and binary handling functionality.
 *
 * Key Functions:
 * - clearQuarantine: Remove macOS quarantine attributes
 * - ensureExecutable: Set executable permissions on Unix systems
 * - getExpectedAssetName: Generate platform-specific binary names
 * - getPlatformName: Map Node.js platform names to release names
 * - getArchName: Map Node.js arch names to release names
 *
 * Platform Support:
 * - macOS: Quarantine handling, executable permissions
 * - Linux: Executable permissions, binary naming
 * - Windows: Special binary handling, .exe extensions
 *
 * Features:
 * - Cross-platform binary management
 * - Automatic platform detection
 * - GitHub release asset naming conventions
 * - File permission management
 *
 * Usage:
 * - SEA binary updates and replacements
 * - Cross-platform asset downloads
 * - File permission management
 */

import { promises as fs } from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

/**
 * Platform name mappings for GitHub releases.
 */
const platformNameByOs = new Map([
  ['darwin', 'macos'],
  ['linux', 'linux'],
  ['win32', 'win'],
])

/**
 * Architecture name mappings for GitHub releases.
 */
const archNameByArch = new Map([
  ['arm64', 'arm64'],
  ['x64', 'x64'],
])

/**
 * Map Node.js platform names to GitHub release names.
 */
function getPlatformName(): string {
  const platform = process.platform
  return platformNameByOs.get(platform) ?? platform
}

/**
 * Map Node.js arch names to GitHub release names.
 */
function getArchName(): string {
  const arch = process.arch
  return archNameByArch.get(arch) ?? arch
}

/**
 * Generate the expected asset name for the current platform.
 * Used for downloading platform-specific binaries from GitHub releases.
 */
function getExpectedAssetName(): string {
  const platformName = getPlatformName()
  const archName = getArchName()
  const extension = process.platform === 'win32' ? '.exe' : ''
  return `socket-${platformName}-${archName}${extension}`
}

/**
 * Clear macOS quarantine attribute from a file.
 * This prevents macOS from blocking execution of downloaded binaries.
 */
async function clearQuarantine(filePath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return
  }

  try {
    await spawn('xattr', ['-d', 'com.apple.quarantine', filePath], {
      stdio: 'ignore',
    })
    logger.debug('Cleared quarantine attribute')
  } catch (e) {
    logger.debug(
      `Failed to clear quarantine: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * Ensure file is executable on Unix systems.
 * Sets 0o755 permissions (rwxr-xr-x) for proper binary execution.
 */
async function ensureExecutable(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  try {
    await fs.chmod(filePath, 0o755)
    logger.debug('Set executable permissions')
  } catch (e) {
    logger.warn(
      `Failed to set executable permissions: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * Check if the current platform/architecture combination is supported.
 * Based on available GitHub release assets.
 */
function isPlatformSupported(): boolean {
  const platformName = getPlatformName()
  const archName = getArchName()

  // Check supported combinations based on GitHub releases.
  if (platformName === 'win' && archName === 'x64') {
    return true
  }
  if (
    platformName === 'macos' &&
    (archName === 'arm64' || archName === 'x64')
  ) {
    return true
  }
  if (
    platformName === 'linux' &&
    (archName === 'x64' || archName === 'arm64')
  ) {
    return true
  }

  return false
}

export {
  clearQuarantine,
  ensureExecutable,
  getArchName,
  getExpectedAssetName,
  getPlatformName,
  isPlatformSupported,
}
