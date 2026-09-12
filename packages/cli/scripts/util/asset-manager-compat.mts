/**
 * @file Backward-compatible wrappers for AssetManager. Maintains existing API
 *   signatures from sea-build-utils/downloads.mts while using the unified
 *   AssetManager internally. Phase 1 of AssetManager migration - provides
 *   drop-in replacements without modifying existing code.
 */

import { AssetManager } from './asset-manager.mts'

let cachedLibc

export function detectMusl() {
  if (process.platform !== 'linux') {
    return false
  }
  if (cachedLibc !== undefined) {
    return cachedLibc === 'musl'
  }
  try {
    const report = process.report.getReport()
    cachedLibc = report.header.glibcVersionRuntime ? 'glibc' : 'musl'
  } catch {
    cachedLibc = 'glibc'
  }
  return cachedLibc === 'musl'
}

/**
 * Shared AssetManager instance for all wrapper functions. Uses default
 * configuration matching downloads.mts behavior.
 */
const assetManager = new AssetManager({
  cacheEnabled: true,
  quiet: false,
})

/**
 * Download Node.js binary for a specific platform (backward-compatible
 * wrapper). Maintains exact API signature from sea-build-utils/downloads.mts.
 *
 * @example
 *   const nodePath = await downloadNodeBinary('20251213-7cf90d2', 'darwin', 'arm64')
 *   // Returns: /path/to/build-infra/build/downloaded/node-smol/darwin-arm64/node
 *
 * @param {string} version - Node.js version tag suffix (e.g.,
 *   "20251213-7cf90d2").
 * @param {string} platform - Platform identifier (darwin, linux, win32).
 * @param {string} arch - Architecture identifier (arm64, x64).
 * @param {string} [libc] - Linux libc variant ('musl' for Alpine, undefined for
 *   glibc).
 *
 * @returns {Promise<string>} Absolute path to downloaded node binary.
 */
export async function downloadNodeBinary(version, platform, arch, libc) {
  return assetManager.downloadBinary({
    arch,
    libc,
    localOverride: 'SOCKET_CLI_LOCAL_NODE_SMOL',
    platform,
    tool: 'node-smol',
    version,
  })
}

/**
 * Download binject binary for the current platform (backward-compatible
 * wrapper). Maintains exact API signature from sea-build-utils/downloads.mts.
 *
 * @example
 *   const binjectPath = await downloadBinject('1.0.0')
 *   // Returns: /path/to/build-infra/build/downloaded/binject/darwin-arm64/binject
 *
 * @param {string} version - Binject version (e.g., "1.0.0").
 *
 * @returns {Promise<string>} Absolute path to downloaded binject binary.
 */
export async function downloadBinject(version) {
  const platform = process.platform
  const arch = process.arch

  // Detect actual libc on Linux, musl for Alpine, glibc for standard distros.
  const libc = detectMusl() ? 'musl' : undefined

  return assetManager.downloadBinary({
    arch,
    libc,
    platform,
    tool: 'binject',
    version,
  })
}
