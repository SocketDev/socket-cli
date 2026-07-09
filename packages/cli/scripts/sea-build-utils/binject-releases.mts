import { logTransientErrorHelp } from 'build-infra/lib/github-error-utils'

import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'

/**
 * Get GitHub API authentication headers. Uses GH_TOKEN or GITHUB_TOKEN
 * environment variables if available.
 *
 * @returns Headers object for GitHub API requests.
 */
export function getAuthHeaders() {
  const token = process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token && { Authorization: `Bearer ${token}` }),
  }
}

/**
 * Get the latest binject release version from socket-btm. Returns the version
 * string (e.g., "1.0.0").
 *
 * @example
 *   const version = await getLatestBinjectVersion()
 *   // "1.0.0"
 *
 * @returns Promise resolving to binject version string.
 *
 * @throws {Error} When socket-btm releases cannot be fetched.
 */
export async function getLatestBinjectVersion() {
  try {
    // per_page=100: the default page size (30) can bury the newest
    // binject-* tag under newer releases of the repo's other artifacts
    // (lief, stubs, curl, …), making the find below miss it entirely.
    const response = await httpRequest(
      'https://api.github.com/repos/SocketDev/socket-btm/releases?per_page=100',
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
          ? new Date(Number(rateLimitReset) * 1000).toLocaleString()
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

    // Find the latest binject release.
    const binjectRelease = releases.find(release =>
      release?.tag_name?.startsWith('binject-'),
    )

    if (!binjectRelease) {
      throw new Error('No binject release found in socket-btm')
    }

    if (!binjectRelease.tag_name) {
      throw new Error('Invalid release data: missing tag_name')
    }

    // Extract the version (e.g., "binject-1.0.0" -> "1.0.0").
    return binjectRelease.tag_name.replace('binject-', '')
  } catch (e) {
    await logTransientErrorHelp(e)
    throw new Error('Failed to fetch latest socket-btm binject release', {
      cause: e,
    })
  }
}
