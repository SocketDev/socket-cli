/**
 * @fileoverview Backward-compatible wrappers for AssetManager.
 * Maintains existing API signatures from sea-build-utils/downloads.mjs
 * while using the unified AssetManager internally.
 *
 * Phase 1 of AssetManager migration - provides drop-in replacements
 * without modifying existing code.
 */

import { AssetManager } from './asset-manager.mjs'

/**
 * Shared AssetManager instance for all wrapper functions.
 * Uses default configuration matching downloads.mjs behavior.
 */
const assetManager = new AssetManager({
  cacheEnabled: true,
  quiet: false,
})

/**
 * Download Node.js binary for a specific platform (backward-compatible wrapper).
 * Maintains exact API signature from sea-build-utils/downloads.mjs.
 *
 * @param {string} version - Node.js version tag suffix (e.g., "20251213-7cf90d2").
 * @param {string} platform - Platform identifier (darwin, linux, win32).
 * @param {string} arch - Architecture identifier (arm64, x64).
 * @param {string} [libc] - Linux libc variant ('musl' for Alpine, undefined for glibc).
 * @returns {Promise<string>} Absolute path to downloaded node binary.
 *
 * @example
 * const nodePath = await downloadNodeBinary('20251213-7cf90d2', 'darwin', 'arm64')
 * // Returns: /path/to/build-infra/build/downloaded/node-smol/darwin-arm64/node
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
 * Download binject binary for the current platform (backward-compatible wrapper).
 * Maintains exact API signature from sea-build-utils/downloads.mjs.
 *
 * @param {string} version - Binject version (e.g., "1.0.0").
 * @returns {Promise<string>} Absolute path to downloaded binject binary.
 *
 * @example
 * const binjectPath = await downloadBinject('1.0.0')
 * // Returns: /path/to/build-infra/build/downloaded/binject/darwin-arm64/binject
 */
export async function downloadBinject(version) {
  const platform = process.platform
  const arch = process.arch

  // Linux uses musl variant for broader compatibility (matches downloads.mjs behavior).
  const libc = platform === 'linux' ? 'musl' : undefined

  return assetManager.downloadBinary({
    arch,
    libc,
    platform,
    tool: 'binject',
    version,
  })
}

/**
 * Get the latest binject release version from socket-btm.
 * Returns the version string (e.g., "1.0.0").
 *
 * Note: This function currently delegates to the original implementation
 * in sea-build-utils/downloads.mjs. Future enhancement: move to AssetManager.
 *
 * @returns {Promise<string>} Binject version string.
 * @throws {Error} When socket-btm releases cannot be fetched.
 *
 * @example
 * const version = await getLatestBinjectVersion()
 * // "1.0.0"
 */
export async function getLatestBinjectVersion() {
  // Delegate to original implementation for now.
  // TODO: Move this to AssetManager in Phase 4.
  const { getLatestBinjectVersion: getLatest } = await import(
    '../sea-build-utils/downloads.mjs'
  )
  return getLatest()
}
