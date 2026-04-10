/**
 * Socket Firewall (sfw) version getter functions.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding version info into the binary.
 *
 * sfw uses two different distributions:
 * - GitHub binary (SocketDev/sfw-free): Used for SEA builds, version like "v1.6.1"
 * - npm package (sfw): Used for CLI dlx, version like "2.0.4"
 */

import process from 'node:process'

/**
 * Get the GitHub release version for sfw (used in SEA builds).
 */
export function getSwfVersion(): string {
  const version = process.env['INLINED_SFW_VERSION']
  if (!version) {
    throw new Error(
      'INLINED_SFW_VERSION not found. Please ensure sfw is properly configured in bundle-tools.json.',
    )
  }
  return version
}

/**
 * Get the npm package version for sfw (used in CLI dlx).
 */
export function getSfwNpmVersion(): string {
  const version = process.env['INLINED_SFW_NPM_VERSION']
  if (!version) {
    throw new Error(
      'INLINED_SFW_NPM_VERSION not found. Please ensure sfw npmVersion is configured in bundle-tools.json.',
    )
  }
  return version
}
