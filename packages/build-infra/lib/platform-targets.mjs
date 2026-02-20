/**
 * @fileoverview Shared platform target utilities for SEA builds.
 * Provides constants and parsing functions for platform/arch/libc combinations.
 */

/**
 * Valid platform targets for SEA builds.
 * Format: <platform>-<arch>[-musl]
 */
export const PLATFORM_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-arm64-musl',
  'linux-x64',
  'linux-x64-musl',
  'win32-arm64',
  'win32-x64',
]

/**
 * Valid platforms.
 */
export const VALID_PLATFORMS = ['darwin', 'linux', 'win32']

/**
 * Valid architectures.
 */
export const VALID_ARCHS = ['arm64', 'x64']

/**
 * Parsed platform target information.
 * @typedef {Object} PlatformTargetInfo
 * @property {string} platform - Platform (darwin, linux, win32).
 * @property {string} arch - Architecture (arm64, x64).
 * @property {string} [libc] - Optional libc variant (musl).
 */

/**
 * Parse a platform target string into components.
 * Handles formats: darwin-arm64, linux-x64, linux-arm64-musl, win32-x64
 *
 * @param {string} target - Target string (e.g., "darwin-arm64" or "linux-x64-musl").
 * @returns {PlatformTargetInfo | null} Parsed info or null if invalid.
 *
 * @example
 * parsePlatformTarget('darwin-arm64')
 * // { platform: 'darwin', arch: 'arm64' }
 *
 * @example
 * parsePlatformTarget('linux-x64-musl')
 * // { platform: 'linux', arch: 'x64', libc: 'musl' }
 */
export function parsePlatformTarget(target) {
  if (!target || typeof target !== 'string') {
    return null
  }

  // Handle musl suffix (linux-arm64-musl, linux-x64-musl).
  if (target.endsWith('-musl')) {
    const base = target.slice(0, -5) // Remove '-musl'.
    const parts = base.split('-')
    if (
      parts.length === 2 &&
      parts[0] === 'linux' &&
      VALID_ARCHS.includes(parts[1])
    ) {
      return { arch: parts[1], libc: 'musl', platform: 'linux' }
    }
    return null
  }

  // Handle standard platform-arch.
  const parts = target.split('-')
  if (parts.length === 2) {
    const [platform, arch] = parts
    if (VALID_PLATFORMS.includes(platform) && VALID_ARCHS.includes(arch)) {
      return { arch, platform }
    }
  }

  return null
}

/**
 * Check if a string is a valid platform target.
 *
 * @param {string} target - Target string to validate.
 * @returns {boolean} True if valid platform target.
 */
export function isPlatformTarget(target) {
  return PLATFORM_TARGETS.includes(target)
}

/**
 * Format platform info back into a target string.
 *
 * @param {string} platform - Platform (darwin, linux, win32).
 * @param {string} arch - Architecture (arm64, x64).
 * @param {string} [libc] - Optional libc variant (musl).
 * @returns {string} Target string (e.g., "linux-x64-musl").
 */
export function formatPlatformTarget(platform, arch, libc) {
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  return `${platform}-${arch}${muslSuffix}`
}

/**
 * Parsed platform arguments from CLI.
 * @typedef {Object} PlatformArgs
 * @property {string | null} platform - Platform or null.
 * @property {string | null} arch - Architecture or null.
 * @property {string | null} libc - Libc variant or null.
 */

/**
 * Parse CLI arguments for platform/arch/target/libc flags.
 *
 * @param {string[]} args - CLI arguments array.
 * @returns {PlatformArgs} Parsed platform arguments.
 *
 * @example
 * parsePlatformArgs(['--platform=darwin', '--arch=arm64'])
 * // { platform: 'darwin', arch: 'arm64', libc: null }
 *
 * @example
 * parsePlatformArgs(['--target=linux-x64-musl'])
 * // { platform: 'linux', arch: 'x64', libc: 'musl' }
 */
export function parsePlatformArgs(args) {
  const result = { arch: null, libc: null, platform: null }

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      result.platform = arg.split('=')[1]
    } else if (arg.startsWith('--arch=')) {
      result.arch = arg.split('=')[1]
    } else if (arg.startsWith('--libc=')) {
      result.libc = arg.split('=')[1]
    } else if (arg.startsWith('--target=')) {
      const parsed = parsePlatformTarget(arg.split('=')[1])
      if (parsed) {
        result.platform = parsed.platform
        result.arch = parsed.arch
        result.libc = parsed.libc ?? null
      }
    }
  }

  return result
}
