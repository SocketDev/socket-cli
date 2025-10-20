/**
 * @fileoverview Platform detection and binary testing helpers
 *
 * Utilities for detecting platform characteristics, testing binaries,
 * and handling platform-specific operations.
 *
 * Used by:
 * - build-yao-pkg-node.mjs (strip commands, signing)
 * - build-sea.mjs (platform-specific builds)
 * - Other build scripts requiring platform detection
 */

import { stat } from 'node:fs/promises'
import { arch, platform } from 'node:os'

import { spawn } from '@socketsecurity/lib/spawn'

/**
 * Get normalized platform information.
 *
 * @returns {Object} Platform details
 * @property {string} platform - OS platform (darwin, linux, win32)
 * @property {string} arch - CPU architecture (x64, arm64)
 * @property {boolean} isWindows - True if Windows
 * @property {boolean} isMacOS - True if macOS
 * @property {boolean} isLinux - True if Linux
 * @property {Object} normalized - Normalized names
 * @property {string} executableExtension - Executable file extension
 * @property {Array<string>|null} stripCommand - Platform-specific strip command
 * @property {Array<string>|null} signCommand - Platform-specific sign command
 *
 * @example
 * const info = getPlatformInfo()
 * logger.log(`Running on ${info.normalized.platform} ${info.normalized.arch}`)
 */
export function getPlatformInfo() {
  const currentPlatform = platform()
  const currentArch = arch()

  return {
    platform: currentPlatform,
    arch: currentArch,
    isWindows: currentPlatform === 'win32',
    isMacOS: currentPlatform === 'darwin',
    isLinux: currentPlatform === 'linux',
    normalized: {
      platform: normalizePlatform(currentPlatform),
      arch: normalizeArch(currentArch),
    },
    executableExtension: currentPlatform === 'win32' ? '.exe' : '',
    stripCommand: getStripCommand(currentPlatform),
    signCommand: getSignCommand(currentPlatform),
  }
}

/**
 * Test binary basic functionality (smoke test).
 *
 * @param {string} binaryPath - Path to binary to test
 * @param {Array<string>} [tests=['version', 'help']] - Tests to run
 * @returns {Promise<{allPassed: boolean, results: Object}>} Test results
 *
 * @example
 * const { allPassed, results } = await testBinary('/path/to/node')
 * if (!allPassed) {
 *   logger.error('Binary failed smoke tests')
 * }
 */
export async function testBinary(binaryPath, tests = ['version', 'help']) {
  const results = {}

  for (const test of tests) {
    try {
      let args = []
      let expectedPattern = null

      switch (test) {
        case 'version':
          args = ['--version']
          expectedPattern = /v?\d+\.\d+\.\d+/
          break

        case 'help':
          args = ['--help']
          expectedPattern = /usage|options|commands/i
          break

        case 'basic':
          args = ['-e', 'console.log("test")']
          expectedPattern = /^test$/
          break

        default:
          throw new Error(`Unknown test: ${test}`)
      }

      const result = await spawn(binaryPath, args, {
        stdio: 'pipe',
        shell: false,
      })

      const { code, stderr, stdout } = result

      results[test] = {
        passed:
          code === 0 && (!expectedPattern || expectedPattern.test(stdout)),
        stdout,
        stderr,
        code,
      }
    } catch (e) {
      results[test] = {
        passed: false,
        error: e.message,
      }
    }
  }

  return {
    allPassed: Object.values(results).every(r => r.passed),
    results,
  }
}

/**
 * Get binary size and basic info.
 *
 * @param {string} binaryPath - Path to binary
 * @returns {Promise<Object>} Binary information
 * @property {string} path - Binary path
 * @property {number} size - Size in bytes
 * @property {number} sizeKB - Size in KB
 * @property {string} sizeMB - Size in MB (formatted)
 * @property {string} mode - File permissions (octal)
 * @property {boolean} isExecutable - True if executable bit set
 * @property {Date} modified - Last modified date
 *
 * @example
 * const info = await getBinaryInfo('/path/to/node')
 * logger.log(`Binary size: ${info.sizeMB}`)
 */
export async function getBinaryInfo(binaryPath) {
  const stats = await stat(binaryPath)
  const sizeKB = Math.round(stats.size / 1024)
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)

  return {
    path: binaryPath,
    size: stats.size,
    sizeKB,
    sizeMB: `${sizeMB} MB`,
    mode: stats.mode.toString(8).slice(-3),
    isExecutable: !!(stats.mode & 0o111),
    modified: stats.mtime,
  }
}

/**
 * Compare binary sizes.
 *
 * @param {number} before - Size before (bytes)
 * @param {number} after - Size after (bytes)
 * @returns {Object} Size comparison
 * @property {number} before - Before size
 * @property {number} after - After size
 * @property {number} diff - Difference (positive = increase)
 * @property {string} diffPercent - Percentage change
 * @property {number} reduction - Reduction amount (0 if increased)
 * @property {number} increase - Increase amount (0 if reduced)
 * @property {boolean} improved - True if size reduced
 *
 * @example
 * const comparison = compareBinarySizes(48_000_000, 40_000_000)
 * logger.log(`Reduced by ${comparison.diffPercent}`)
 */
export function compareBinarySizes(before, after) {
  const diff = after - before
  const diffPercent = ((diff / before) * 100).toFixed(1)

  return {
    before,
    after,
    diff,
    diffPercent: `${diffPercent}%`,
    reduction: diff < 0 ? Math.abs(diff) : 0,
    increase: diff > 0 ? diff : 0,
    improved: diff < 0,
  }
}

/**
 * Format byte size to human-readable format.
 *
 * @param {number} bytes - Size in bytes
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string} Formatted size
 *
 * @example
 * formatBytes(1536) // '1.50 KB'
 * formatBytes(1048576) // '1.00 MB'
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) {return '0 Bytes'}

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Number.parseFloat((bytes / k ** i).toFixed(decimals))} ${sizes[i]}`
}

/**
 * Normalize platform name to common format.
 *
 * @private
 * @param {string} platformName - OS platform (darwin, win32, linux)
 * @returns {string} Normalized name (macos, windows, linux)
 */
function normalizePlatform(platformName) {
  const map = {
    __proto__: null,
    darwin: 'macos',
    win32: 'windows',
    linux: 'linux',
  }
  return map[platformName] || platformName
}

/**
 * Normalize architecture name to common format.
 *
 * @private
 * @param {string} archName - CPU architecture (x64, arm64, ia32)
 * @returns {string} Normalized name (x64, arm64, x86)
 */
function normalizeArch(archName) {
  const map = {
    __proto__: null,
    x64: 'x64',
    arm64: 'arm64',
    ia32: 'x86',
  }
  return map[archName] || archName
}

/**
 * Get platform-specific strip command.
 *
 * @private
 * @param {string} platformName - OS platform
 * @returns {Array<string>|null} Strip command and args, or null if not supported
 */
function getStripCommand(platformName) {
  switch (platformName) {
    case 'darwin':
      return ['strip', '-S']

    case 'linux':
      return ['strip', '--strip-all']

    case 'win32':
      return null // No stripping on Windows.

    default:
      return null
  }
}

/**
 * Get platform-specific sign command.
 *
 * @private
 * @param {string} platformName - OS platform
 * @returns {Array<string>|null} Sign command and args, or null if not supported
 */
function getSignCommand(platformName) {
  switch (platformName) {
    case 'darwin':
      return ['codesign', '--force', '--sign', '-']

    case 'win32':
      return null // Handled differently on Windows.

    default:
      return null
  }
}
