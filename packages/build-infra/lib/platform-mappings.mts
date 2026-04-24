import process from 'node:process'

/**
 * Shared platform and architecture mappings for GitHub release assets.
 *
 * Maps Node.js platform/architecture names to release asset naming conventions.
 * Used consistently across all download and build scripts to avoid duplication.
 */

import { existsSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { ALPINE_RELEASE_FILE } from './constants.mts'

const logger = getDefaultLogger()

/**
 * Maps Node.js platform names to GitHub release platform names.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RELEASE_PLATFORM_MAP = Object.freeze({
  __proto__: null,
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win',
})

/**
 * Maps Node.js architecture names to GitHub release architecture names.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RELEASE_ARCH_MAP = Object.freeze({
  __proto__: null,
  arm64: 'arm64',
  ia32: 'x86',
  x64: 'x64',
})

/**
 * Get platform-arch string for internal directory paths (download locations).
 * Uses Node.js platform naming directly (win32, darwin, linux).
 *
 * @param {string} platform - Node.js platform (darwin, linux, win32).
 * @param {string} arch - Node.js architecture (arm64, x64, ia32).
 * @param {string|undefined} [libc] - C library variant (musl, glibc) - Linux only.
 * @returns {string} Platform-arch string (e.g., 'win32-x64', 'linux-x64-musl').
 * @throws {Error} If platform/arch is unsupported.
 */
export function getPlatformArch(platform, arch, libc) {
  const releaseArch = RELEASE_ARCH_MAP[arch]

  if (!releaseArch) {
    throw new Error(`Unsupported arch: ${arch}`)
  }
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  // Validate libc parameter.
  if (libc && libc !== 'musl' && libc !== 'glibc') {
    throw new Error(`Invalid libc: ${libc}. Valid options: musl, glibc`)
  }
  if (libc && platform !== 'linux') {
    throw new Error(
      `libc parameter is only valid for Linux platform (got platform: ${platform})`,
    )
  }

  // Add musl suffix for Linux musl builds.
  const muslSuffix = platform === 'linux' && libc === 'musl' ? '-musl' : ''
  // Use Node.js platform naming directly for directory paths
  return `${platform}-${releaseArch}${muslSuffix}`
}

/**
 * Get platform-arch string for GitHub release asset naming.
 * Uses shortened platform names (win instead of win32).
 *
 * @param {string} platform - Node.js platform (darwin, linux, win32).
 * @param {string} arch - Node.js architecture (arm64, x64, ia32).
 * @param {string|undefined} [libc] - C library variant (musl, glibc) - Linux only.
 * @returns {string} Platform-arch string for assets (e.g., 'win-x64', 'linux-x64-musl').
 * @throws {Error} If platform/arch is unsupported.
 */
export function getAssetPlatformArch(platform, arch, libc) {
  const releasePlatform = RELEASE_PLATFORM_MAP[platform]
  const releaseArch = RELEASE_ARCH_MAP[arch]

  if (!releasePlatform || !releaseArch) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
  }

  // Validate libc parameter.
  if (libc && libc !== 'musl' && libc !== 'glibc') {
    throw new Error(`Invalid libc: ${libc}. Valid options: musl, glibc`)
  }
  if (libc && platform !== 'linux') {
    throw new Error(
      `libc parameter is only valid for Linux platform (got platform: ${platform})`,
    )
  }
  // Warn when libc is missing for Linux - this usually indicates a bug.
  // Use getCurrentPlatformArch() instead, which auto-detects libc.
  if (platform === 'linux' && libc === undefined) {
    logger.warn(
      'getAssetPlatformArch() called for Linux without libc parameter. ' +
        'This may cause builds to output to wrong directory (linux-x64 vs linux-x64-musl). ' +
        'Consider using getCurrentPlatformArch() which auto-detects libc.',
    )
  }

  // Add musl suffix for Linux musl builds.
  const muslSuffix = platform === 'linux' && libc === 'musl' ? '-musl' : ''
  // Use shortened platform names for asset names
  return `${releasePlatform}-${releaseArch}${muslSuffix}`
}

/**
 * Detect if running on musl libc (Alpine Linux).
 *
 * @returns {Promise<boolean>} True if running on musl libc.
 */
export async function isMusl() {
  if (process.platform !== 'linux') {
    return false
  }

  // Check for Alpine release file.
  if (existsSync(ALPINE_RELEASE_FILE)) {
    return true
  }

  // Check ldd version for musl.
  try {
    const result = await spawn('ldd', ['--version'], { stdio: 'pipe' })
    const output = result.stdout + result.stderr
    return output.includes('musl')
  } catch {
    // Expected: ldd may not exist in some environments.
    return false
  }
}

/**
 * Get platform-arch string for the current platform using shared mapping.
 *
 * Resolution order:
 *   1. `PLATFORM_ARCH` env — the explicit value the workflow/Dockerfile injected
 *      (set by .github/workflows/*.yml build-args and every Dockerfile).
 *   2. Cross-compile env (`TARGET_ARCH`, `LIBC`) applied on top of the host's
 *      platform/arch.
 *   3. Full auto-detect via `isMusl()` + `process.arch` + `process.platform`.
 *
 * @returns {Promise<string>} Platform-arch string (e.g., 'win-x64', 'linux-x64-musl').
 */
export async function getCurrentPlatformArch() {
  // If the workflow or Dockerfile set PLATFORM_ARCH explicitly, trust it.
  if (process.env.PLATFORM_ARCH) {
    return process.env.PLATFORM_ARCH
  }
  // Respect LIBC environment variable for cross-compilation (set by workflows)
  // Falls back to isMusl() for host detection when not cross-compiling.
  const libc = process.env.LIBC || ((await isMusl()) ? 'musl' : undefined)
  // Respect TARGET_ARCH for cross-compilation (set by workflows/Makefiles)
  const arch = process.env.TARGET_ARCH || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

/**
 * Read the requested glibc floor from the GLIBC_FLOOR env var.
 *
 * Returned value is a string like "2.17" or "2.28", or undefined when unset.
 * No behavior change today — this is groundwork for threading a glibc floor
 * dimension through cache keys and Docker image selection when we lower the
 * floor. See packages/node-smol-builder/docs/plans/glibc-floor-lowering.md.
 *
 * Callers should treat `undefined` as "fall back to the repo's current default
 * build image (glibc 2.28)" so behavior is unchanged until the env is set.
 *
 * @returns {string | undefined} Requested glibc floor, or undefined.
 */
export function getRequestedGlibcFloor(): string | undefined {
  const raw = process.env.GLIBC_FLOOR
  if (!raw) {
    return undefined
  }
  const trimmed = raw.trim()
  // Accept "2.17" or "2.28". Reject anything else so typos surface loudly.
  if (trimmed === '2.17' || trimmed === '2.28') {
    return trimmed
  }
  throw new Error(
    `Unrecognized GLIBC_FLOOR="${raw}". Expected "2.17" or "2.28".`,
  )
}

/**
 * Check if tar supports --no-absolute-names (GNU tar has it, busybox tar doesn't).
 *
 * @returns {Promise<boolean>} True if tar supports --no-absolute-names.
 */
export async function tarSupportsNoAbsoluteNames() {
  try {
    const result = await spawn('tar', ['--help'], { stdio: 'pipe' })
    return (result.stdout || '').includes('--no-absolute-names')
  } catch {
    return false
  }
}

/**
 * Check if tar supports --overwrite (GNU tar has it, BSD/macOS tar doesn't).
 *
 * @returns {Promise<boolean>} True if tar supports --overwrite.
 */
export async function tarSupportsOverwrite() {
  // BSD tar on macOS doesn't support --overwrite.
  // Quick platform check to avoid spawning tar unnecessarily.
  if (process.platform === 'darwin') {
    return false
  }
  try {
    const result = await spawn('tar', ['--help'], { stdio: 'pipe' })
    // Look for the actual --overwrite flag, not just the word "overwrite"
    // (BSD tar mentions "overwrite" in the -k flag description but doesn't support --overwrite)
    return /^\s*--overwrite\b/m.test(result.stdout || '')
  } catch {
    return false
  }
}
