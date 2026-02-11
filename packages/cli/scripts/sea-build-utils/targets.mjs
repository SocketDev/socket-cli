/**
 * @fileoverview Build target selection and platform configuration for SEA builds.
 * Manages the list of supported platforms and Node.js version selection.
 */

import { httpRequest } from '@socketsecurity/lib/http-request'

import { getAuthHeaders } from './downloads.mjs'

/**
 * Generate build targets for different platforms.
 * Returns array of 8 platform targets (darwin, linux, windows × arm64/x64, musl variants).
 *
 * @returns Array of build target configurations.
 *
 * @example
 * const targets = await getBuildTargets()
 * // [
 * //   { platform: 'win32', arch: 'arm64', nodeVersion: '20251213-7cf90d2', outputName: 'socket-win-arm64.exe' },
 * //   ...
 * // ]
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
 * Get the default Node.js version for SEA builds.
 * Returns the socket-btm tag suffix (e.g., "20251213-7cf90d2").
 * Prefers SOCKET_CLI_SEA_NODE_VERSION env var, falls back to latest socket-btm release.
 *
 * @returns Node.js version tag suffix.
 *
 * @example
 * const version = await getDefaultNodeVersion()
 * // "20251213-7cf90d2"
 */
export async function getDefaultNodeVersion() {
  if (process.env['SOCKET_CLI_SEA_NODE_VERSION']) {
    return process.env['SOCKET_CLI_SEA_NODE_VERSION']
  }

  // Fetch the latest node-smol release tag from socket-btm.
  return await getLatestSocketBtmNodeRelease()
}

/**
 * Fetch the latest node-smol release tag from socket-btm.
 * Returns the tag suffix (e.g., "20251213-7cf90d2").
 *
 * @returns Latest node-smol version tag suffix.
 * @throws {Error} When socket-btm releases cannot be fetched.
 *
 * @example
 * const version = await getLatestSocketBtmNodeRelease()
 * // "20251213-7cf90d2"
 */
export async function getLatestSocketBtmNodeRelease() {
  try {
    const response = await httpRequest(
      'https://api.github.com/repos/SocketDev/socket-btm/releases',
      {
        headers: getAuthHeaders(),
      },
    )

    if (!response.ok) {
      // Detect specific error types.
      if (response.status === 401) {
        throw new Error(
          'GitHub API authentication failed. Please check your GH_TOKEN or GITHUB_TOKEN environment variable.',
        )
      }

      if (response.status === 403) {
        const rateLimitReset = response.headers['x-ratelimit-reset']
        const resetTime = rateLimitReset
          ? new Date(Number(rateLimitReset) * 1_000).toLocaleString()
          : 'unknown'
        throw new Error(
          `GitHub API rate limit exceeded. Resets at: ${resetTime}. ` +
            'Set GH_TOKEN or GITHUB_TOKEN environment variable to increase rate limits ' +
            '(unauthenticated: 60/hour, authenticated: 5,000/hour).',
        )
      }

      throw new Error(
        `Failed to fetch socket-btm releases: ${response.status} ${response.statusText}`,
      )
    }

    const releases = JSON.parse(response.body.toString('utf8'))

    // Validate API response structure.
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error(
        'Invalid API response: expected non-empty array of releases',
      )
    }

    // Find the latest node-smol release.
    const nodeSmolRelease = releases.find(release =>
      release?.tag_name?.startsWith('node-smol-'),
    )

    if (!nodeSmolRelease) {
      throw new Error('No node-smol release found in socket-btm')
    }

    if (!nodeSmolRelease.tag_name) {
      throw new Error('Invalid release data: missing tag_name')
    }

    // Extract the tag suffix (e.g., "node-smol-20251213-7cf90d2" -> "20251213-7cf90d2").
    return nodeSmolRelease.tag_name.replace('node-smol-', '')
  } catch (e) {
    throw new Error('Failed to fetch latest socket-btm node-smol release', {
      cause: e,
    })
  }
}
