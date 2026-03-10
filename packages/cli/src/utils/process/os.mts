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

import { existsSync, promises as fs, readFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

// Cache for libc detection (only need to check once per process).
let cachedLibc: string | undefined

/**
 * Reset the libc detection cache.
 * This is primarily for testing purposes to allow re-detection.
 */
function resetLibcCache(): void {
  cachedLibc = undefined
}

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
 * Platform name mappings for npm @socketbin packages.
 * Uses Node.js platform names directly (darwin, linux, win32).
 */
const npmPlatformByOs = new Map([
  ['darwin', 'darwin'],
  ['linux', 'linux'],
  ['win32', 'win32'],
])

/**
 * Architecture name mappings for npm @socketbin packages.
 * Uses Node.js arch names directly (arm64, x64).
 */
const npmArchByArch = new Map([
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
 * Get npm platform name for @socketbin packages.
 * Uses Node.js platform names (darwin, linux, win32).
 */
function getNpmPlatform(): string {
  const platform = process.platform
  return npmPlatformByOs.get(platform) ?? platform
}

/**
 * Get npm arch name for @socketbin packages.
 * Uses Node.js arch names (arm64, x64).
 */
function getNpmArch(): string {
  const arch = process.arch
  return npmArchByArch.get(arch) ?? arch
}

/**
 * Detect if running on musl libc (Alpine Linux, etc.).
 * Uses multiple detection methods for reliability.
 */
function detectMusl(): boolean {
  // Only check on Linux.
  if (process.platform !== 'linux') {
    return false
  }

  // Check cached result.
  if (cachedLibc !== undefined) {
    return cachedLibc === 'musl'
  }

  // Method 1: Check /etc/os-release for Alpine.
  try {
    if (existsSync('/etc/os-release')) {
      const osRelease = readFileSync('/etc/os-release', 'utf8')
      if (osRelease.includes('Alpine') || osRelease.includes('alpine')) {
        cachedLibc = 'musl'
        return true
      }
    }
  } catch {
    // Ignore errors, try next method.
  }

  // Method 2: Check if ldd references musl.
  try {
    if (existsSync('/lib/ld-musl-x86_64.so.1') ||
        existsSync('/lib/ld-musl-aarch64.so.1')) {
      cachedLibc = 'musl'
      return true
    }
  } catch {
    // Ignore errors.
  }

  // Method 3: Check /proc/version for musl indicators.
  try {
    if (existsSync('/proc/version')) {
      const version = readFileSync('/proc/version', 'utf8')
      if (version.includes('musl')) {
        cachedLibc = 'musl'
        return true
      }
    }
  } catch {
    // Ignore errors.
  }

  cachedLibc = 'glibc'
  return false
}

/**
 * Get the libc suffix for package names.
 * Returns "-musl" on musl systems, empty string otherwise.
 */
function getLibcSuffix(): string {
  return detectMusl() ? '-musl' : ''
}

/**
 * Get the @socketbin package name for the current platform.
 * Returns package name like "@socketbin/cli-darwin-arm64" or
 * "@socketbin/cli-linux-x64-musl" on Alpine.
 */
function getSocketbinPackageName(): string {
  const platform = getNpmPlatform()
  const arch = getNpmArch()
  const libcSuffix = getLibcSuffix()
  return `@socketbin/cli-${platform}-${arch}${libcSuffix}`
}

/**
 * Get the binary name for the current platform.
 * Returns "socket" on Unix, "socket.exe" on Windows.
 */
function getBinaryName(): string {
  return process.platform === 'win32' ? 'socket.exe' : 'socket'
}

/**
 * Get the relative path to the binary within @socketbin package.
 * Returns "bin/socket" or "bin/socket.exe".
 */
function getBinaryRelativePath(): string {
  return `bin/${getBinaryName()}`
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
    logger.log('Cleared quarantine attribute')
  } catch (e) {
    logger.log(
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
    logger.log('Set executable permissions')
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
  detectMusl,
  ensureExecutable,
  getArchName,
  getBinaryName,
  getBinaryRelativePath,
  getExpectedAssetName,
  getLibcSuffix,
  getNpmArch,
  getNpmPlatform,
  getPlatformName,
  getSocketbinPackageName,
  isPlatformSupported,
  resetLibcCache,
}
