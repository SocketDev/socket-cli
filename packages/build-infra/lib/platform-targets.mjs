/**
 * @fileoverview Shared platform target utilities for SEA builds.
 * Provides constants and parsing functions for platform/arch/libc combinations.
 * This is the single source of truth for all platform definitions.
 */

/**
 * Complete platform configuration with all metadata.
 * This is the authoritative source for platform definitions.
 * @type {ReadonlyArray<{
 *   platform: string,
 *   arch: string,
 *   libc?: string,
 *   runner: string,
 *   cpu: string,
 *   os: string,
 *   binExt: string,
 *   description: string
 * }>}
 */
export const PLATFORM_CONFIGS = Object.freeze([
  {
    arch: 'arm64',
    binExt: '',
    cpu: 'arm64',
    description: 'macOS ARM64 (Apple Silicon)',
    os: 'darwin',
    platform: 'darwin',
    runner: 'macos-latest',
  },
  {
    arch: 'x64',
    binExt: '',
    cpu: 'x64',
    description: 'macOS x64 (Intel)',
    os: 'darwin',
    platform: 'darwin',
    runner: 'macos-latest',
  },
  {
    arch: 'arm64',
    binExt: '',
    cpu: 'arm64',
    description: 'Linux ARM64 (glibc)',
    os: 'linux',
    platform: 'linux',
    runner: 'ubuntu-latest',
  },
  {
    arch: 'arm64',
    binExt: '',
    cpu: 'arm64',
    description: 'Linux ARM64 (musl/Alpine)',
    libc: 'musl',
    os: 'linux',
    platform: 'linux',
    runner: 'ubuntu-latest',
  },
  {
    arch: 'x64',
    binExt: '',
    cpu: 'x64',
    description: 'Linux x64 (glibc)',
    os: 'linux',
    platform: 'linux',
    runner: 'ubuntu-latest',
  },
  {
    arch: 'x64',
    binExt: '',
    cpu: 'x64',
    description: 'Linux x64 (musl/Alpine)',
    libc: 'musl',
    os: 'linux',
    platform: 'linux',
    runner: 'ubuntu-latest',
  },
  {
    arch: 'arm64',
    binExt: '.exe',
    cpu: 'arm64',
    description: 'Windows ARM64',
    os: 'win32',
    platform: 'win32',
    runner: 'windows-latest',
  },
  {
    arch: 'x64',
    binExt: '.exe',
    cpu: 'x64',
    description: 'Windows x64',
    os: 'win32',
    platform: 'win32',
    runner: 'windows-latest',
  },
])

/**
 * Valid platform targets for SEA builds.
 * Format: <platform>-<arch>[-musl]
 * Derived from PLATFORM_CONFIGS.
 */
export const PLATFORM_TARGETS = PLATFORM_CONFIGS.map(
  c => `${c.platform}-${c.arch}${c.libc ? `-${c.libc}` : ''}`,
)

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
 * Get the full platform config for a target string.
 *
 * @param {string} target - Target string (e.g., "darwin-arm64" or "linux-x64-musl").
 * @returns {typeof PLATFORM_CONFIGS[number] | undefined} Full platform config or undefined.
 */
export function getPlatformConfig(target) {
  return PLATFORM_CONFIGS.find(
    c => `${c.platform}-${c.arch}${c.libc ? `-${c.libc}` : ''}` === target,
  )
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
      const parts = arg.split('=')
      if (parts.length >= 2) {
        result.platform = parts[1]
      }
    } else if (arg.startsWith('--arch=')) {
      const parts = arg.split('=')
      if (parts.length >= 2) {
        result.arch = parts[1]
      }
    } else if (arg.startsWith('--libc=')) {
      const parts = arg.split('=')
      if (parts.length >= 2) {
        result.libc = parts[1]
      }
    } else if (arg.startsWith('--target=')) {
      const parts = arg.split('=')
      if (parts.length >= 2) {
        const parsed = parsePlatformTarget(parts[1])
        if (parsed) {
          result.platform = parsed.platform
          result.arch = parsed.arch
          result.libc = parsed.libc ?? null
        }
      }
    }
  }

  return result
}
