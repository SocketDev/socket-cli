/**
 * @file Build target selection and platform configuration for SEA builds.
 *   Manages the list of supported platforms and Node.js version selection.
 */

import { NODE_SMOL_VERSION } from '../constants/base-assets.mts'

/**
 * Generate build targets for different platforms. Returns array of 8 platform
 * targets (darwin, linux, windows × arm64/x64, musl variants).
 *
 * @example
 *   const targets = await getBuildTargets()
 *   // [
 *   //   { platform: 'win32', arch: 'arm64', nodeVersion: '20251213-7cf90d2', outputName: 'socket-win-arm64.exe' },
 *   //   ...
 *   // ]
 *
 * @returns Array of build target configurations.
 */
export async function getBuildTargets() {
  const defaultNodeVersion = await getDefaultNodeVersion()

  return [
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-win-arm64.exe',
      platform: 'win32',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-win-x64.exe',
      platform: 'win32',
    },
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-darwin-arm64',
      platform: 'darwin',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-darwin-x64',
      platform: 'darwin',
    },
    {
      arch: 'arm64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-arm64',
      platform: 'linux',
    },
    {
      arch: 'x64',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-x64',
      platform: 'linux',
    },
    {
      arch: 'arm64',
      libc: 'musl',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-arm64-musl',
      platform: 'linux',
    },
    {
      arch: 'x64',
      libc: 'musl',
      nodeVersion: defaultNodeVersion,
      outputName: 'socket-linux-x64-musl',
      platform: 'linux',
    },
  ]
}

/**
 * Get the default Node.js version for SEA builds. Returns the node-smol tag
 * suffix (e.g., "20260418-50af4c8"). Prefers SOCKET_CLI_SEA_NODE_VERSION env
 * var, falls back to the frozen base pinned in constants/base-assets.mts —
 * builds no longer chase the latest socket-btm release (the repo is descoped;
 * the pinned base is mirrored into socket-cli base-assets-* releases).
 *
 * @example
 *   const version = await getDefaultNodeVersion()
 *   // "20260418-50af4c8"
 *
 * @returns Node.js version tag suffix.
 */
export async function getDefaultNodeVersion() {
  return process.env['SOCKET_CLI_SEA_NODE_VERSION'] || NODE_SMOL_VERSION
}
