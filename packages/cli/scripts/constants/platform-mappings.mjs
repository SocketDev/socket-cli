/**
 * @fileoverview Centralized platform and architecture mappings.
 * Maps Node.js identifiers to socket-btm release asset names.
 *
 * Used by:
 * - AssetManager for binary downloads
 * - SEA build utils for target platforms
 * - Security tools downloader
 */

/**
 * Architecture mapping from Node.js identifiers to platform-specific arch names.
 * Maps process.arch values to socket-btm release asset arch identifiers.
 */
export const ARCH_MAP = {
  __proto__: null,
  arm64: 'arm64',
  ia32: 'x86',
  x64: 'x64',
}

/**
 * Platform mapping from Node.js identifiers to platform-specific names.
 * Maps process.platform values to socket-btm release asset platform identifiers.
 */
export const PLATFORM_MAP = {
  __proto__: null,
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win',
}
