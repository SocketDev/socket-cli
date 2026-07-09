/**
 * @file Shared platform target utilities for SEA builds. Provides constants and
 *   parsing functions for platform/arch/libc combinations. This is the single
 *   source of truth for all platform definitions. Naming convention:
 *
 *   - `platform`: Node.js process.platform value (darwin, linux, win32)
 *   - `releasePlatform`: Normalized for file/folder/npm names (darwin, linux,
 *     win)
 */

/**
 * Complete platform configuration entry, describing a single supported
 * platform/arch/libc combination.
 */
export interface PlatformConfig {
  arch: string
  binExt: string
  cpu: string
  description: string
  libc?: string | undefined
  os: string
  platform: string
  releasePlatform: string
  runner: string
}

/**
 * Complete platform configuration with all metadata. This is the authoritative
 * source for platform definitions.
 */
export const PLATFORM_CONFIGS: readonly PlatformConfig[] = Object.freeze([
  {
    arch: 'arm64',
    binExt: '',
    cpu: 'arm64',
    description: 'macOS ARM64 (Apple Silicon)',
    os: 'darwin',
    platform: 'darwin',
    releasePlatform: 'darwin',
    runner: 'macos-latest',
  },
  {
    arch: 'x64',
    binExt: '',
    cpu: 'x64',
    description: 'macOS x64 (Intel)',
    os: 'darwin',
    platform: 'darwin',
    releasePlatform: 'darwin',
    runner: 'macos-latest',
  },
  {
    arch: 'arm64',
    binExt: '',
    cpu: 'arm64',
    description: 'Linux ARM64 (glibc)',
    os: 'linux',
    platform: 'linux',
    releasePlatform: 'linux',
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
    releasePlatform: 'linux',
    runner: 'ubuntu-latest',
  },
  {
    arch: 'x64',
    binExt: '',
    cpu: 'x64',
    description: 'Linux x64 (glibc)',
    os: 'linux',
    platform: 'linux',
    releasePlatform: 'linux',
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
    releasePlatform: 'linux',
    runner: 'ubuntu-latest',
  },
  {
    arch: 'arm64',
    binExt: '.exe',
    cpu: 'arm64',
    description: 'Windows ARM64',
    os: 'win32',
    platform: 'win32',
    releasePlatform: 'win',
    runner: 'windows-latest',
  },
  {
    arch: 'x64',
    binExt: '.exe',
    cpu: 'x64',
    description: 'Windows x64',
    os: 'win32',
    platform: 'win32',
    releasePlatform: 'win',
    runner: 'windows-latest',
  },
])

/**
 * Valid platform targets for SEA builds (using releasePlatform for naming).
 * Format: <releasePlatform>-<arch>[-musl] Derived from PLATFORM_CONFIGS.
 */
export const PLATFORM_TARGETS = PLATFORM_CONFIGS.map(
  c => `${c.releasePlatform}-${c.arch}${c.libc ? `-${c.libc}` : ''}`,
)

/**
 * Get the release platform name for file/folder/npm naming. Converts win32 →
 * win, leaves others unchanged.
 *
 * @param {string} platform - Node.js platform (darwin, linux, win32).
 *
 * @returns {string} Release platform (darwin, linux, win).
 */
export function getReleasePlatform(platform: string) {
  return platform === 'win32' ? 'win' : platform
}

/**
 * Valid platforms (Node.js process.platform values).
 */
const VALID_PLATFORMS = ['darwin', 'linux', 'win32']

/**
 * Valid architectures.
 */
const VALID_ARCHS = ['arm64', 'x64']

/**
 * Parsed platform target information.
 */
export interface PlatformTargetInfo {
  arch: string
  libc?: string | undefined
  platform: string
}

/**
 * Parse a platform target string into components. Handles formats:
 * darwin-arm64, linux-x64, linux-arm64-musl, win-x64, win32-x64 Accepts both
 * 'win' (release naming) and 'win32' (Node.js naming) for Windows.
 *
 * @example
 *   parsePlatformTarget('darwin-arm64')
 *   // { platform: 'darwin', arch: 'arm64' }
 *
 * @example
 *   parsePlatformTarget('linux-x64-musl')
 *   // { platform: 'linux', arch: 'x64', libc: 'musl' }
 *
 * @example
 *   parsePlatformTarget('win-x64')
 *   // { platform: 'win32', arch: 'x64' }
 *
 * @param {string} target - Target string (e.g., "darwin-arm64" or
 *   "linux-x64-musl").
 *
 * @returns {PlatformTargetInfo | undefined} Parsed info or undefined if
 *   invalid.
 */
export function parsePlatformTarget(
  target: string,
): PlatformTargetInfo | undefined {
  if (!target || typeof target !== 'string') {
    return undefined
  }

  // Handle musl suffix (linux-arm64-musl, linux-x64-musl).
  if (target.endsWith('-musl')) {
    const base = target.slice(0, -5) // Remove '-musl'.
    const parts = base.split('-')
    const arch = parts[1]
    if (
      parts.length === 2 &&
      parts[0] === 'linux' &&
      arch !== undefined &&
      VALID_ARCHS.includes(arch)
    ) {
      return { arch, libc: 'musl', platform: 'linux' }
    }
    return undefined
  }

  // Handle standard platform-arch.
  const parts = target.split('-')
  if (parts.length === 2) {
    const [rawPlatform, arch] = parts
    // Normalize 'win' to 'win32' for internal use.
    const platform = rawPlatform === 'win' ? 'win32' : rawPlatform
    if (
      platform !== undefined &&
      arch !== undefined &&
      VALID_PLATFORMS.includes(platform) &&
      VALID_ARCHS.includes(arch)
    ) {
      return { arch, platform }
    }
  }

  return undefined
}

/**
 * Check if a string is a valid platform target.
 *
 * @param {string} target - Target string to validate.
 *
 * @returns {boolean} True if valid platform target.
 */
// oxlint-disable-next-line socket/sort-source-methods -- grouped by phase (parse → validate → resolve → format); alphabetizing would scatter the parse-validate-resolve flow.
export function isPlatformTarget(target: string) {
  return PLATFORM_TARGETS.includes(target)
}

/**
 * Get the full platform config for a target string. Accepts both release naming
 * (win-x64) and Node.js naming (win32-x64).
 *
 * @param {string} target - Target string (e.g., "darwin-arm64", "win-x64", or
 *   "linux-x64-musl").
 *
 * @returns {(typeof PLATFORM_CONFIGS)[number] | undefined} Full platform config
 *   or undefined.
 */
// oxlint-disable-next-line socket/sort-source-methods -- grouped by phase (parse → validate → resolve → format); alphabetizing would scatter the parse-validate-resolve flow.
export function getPlatformConfig(target: string) {
  return PLATFORM_CONFIGS.find(
    c =>
      `${c.releasePlatform}-${c.arch}${c.libc ? `-${c.libc}` : ''}` ===
        target ||
      `${c.platform}-${c.arch}${c.libc ? `-${c.libc}` : ''}` === target,
  )
}

/**
 * Format platform info back into a target string.
 *
 * @param {string} platform - Platform (darwin, linux, win32).
 * @param {string} arch - Architecture (arm64, x64).
 * @param {string} [libc] - Optional libc variant (musl).
 *
 * @returns {string} Target string (e.g., "linux-x64-musl").
 */
// oxlint-disable-next-line socket/sort-source-methods -- grouped by phase (parse → validate → resolve → format); alphabetizing would scatter the parse-validate-resolve flow.
export function formatPlatformTarget(
  platform: string,
  arch: string,
  libc?: string,
) {
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  return `${platform}-${arch}${muslSuffix}`
}

/**
 * Parsed platform arguments from CLI.
 */
export interface PlatformArgs {
  arch: string | undefined
  libc: string | undefined
  platform: string | undefined
}

/**
 * Parse CLI arguments for platform/arch/target/libc flags.
 *
 * @example
 *   parsePlatformArgs(['--platform=darwin', '--arch=arm64'])
 *   // { platform: 'darwin', arch: 'arm64', libc: null }
 *
 * @example
 *   parsePlatformArgs(['--target=linux-x64-musl'])
 *   // { platform: 'linux', arch: 'x64', libc: 'musl' }
 *
 * @param {string[]} args - CLI arguments array.
 *
 * @returns {PlatformArgs} Parsed platform arguments.
 */
// oxlint-disable-next-line socket/sort-source-methods -- grouped by phase (parse → validate → resolve → format); alphabetizing would scatter the parse-validate-resolve flow.
export function parsePlatformArgs(args: string[]): PlatformArgs {
  const result: PlatformArgs = {
    arch: undefined,
    libc: undefined,
    platform: undefined,
  }

  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]
    if (arg === undefined) {
      continue
    }
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
      const targetValue = parts[1]
      if (parts.length >= 2 && targetValue !== undefined) {
        const parsed = parsePlatformTarget(targetValue)
        if (parsed) {
          result.platform = parsed.platform
          result.arch = parsed.arch
          result.libc = parsed.libc ?? undefined
        }
      }
    }
  }

  return result
}
