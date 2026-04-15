/**
 * Shared utilities for fetching GitHub releases.
 */

import path from 'node:path'

import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { httpDownload, httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pRetry } from '@socketsecurity/lib/promises'

const logger = getDefaultLogger()

// Cache GitHub API responses for 4 hours to reduce API calls and avoid rate limiting.
const cache = createTtlCache({
  memoize: true,
  prefix: 'github-releases',
  ttl: 4 * 60 * 60 * 1000, // 4 hours.
})

/**
 * Get GitHub authentication headers if token is available.
 *
 * @returns {object} - Headers object with Authorization if token exists.
 */
function getAuthHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

/**
 * Download a specific release asset.
 *
 * Uses browser_download_url to avoid consuming GitHub API quota.
 * The httpDownload function from @socketsecurity/lib@5.1.3+ automatically
 * follows HTTP redirects, eliminating the need for Octokit's getReleaseAsset API.
 *
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} tag - Release tag name.
 * @param {string} assetName - Asset name to download.
 * @param {string} outputPath - Path to write the downloaded file.
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<void>}
 */
export async function downloadReleaseAsset(
  owner,
  repo,
  tag,
  assetName,
  outputPath,
  { quiet = false } = {},
) {
  // Get the browser_download_url for the asset (doesn't consume API quota for download).
  const downloadUrl = await getReleaseAssetUrl(owner, repo, tag, assetName, {
    quiet,
  })

  if (!downloadUrl) {
    throw new Error(`Asset ${assetName} not found in release ${tag}`)
  }

  // Create output directory.
  await safeMkdir(path.dirname(outputPath))

  // Download using httpDownload which supports redirects and retries.
  // This avoids consuming GitHub API quota for the actual download.
  await httpDownload(downloadUrl, outputPath, {
    logger: quiet ? undefined : logger,
    progressInterval: 10,
    retries: 2,
    retryDelay: 5_000,
  })
}

/**
 * Get latest release tag for a repository with retry logic.
 *
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {object} [options] - Options.
 * @param {string} [options.prefix] - Tag prefix to filter by (for socket-btm tool releases).
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Latest release tag or null if not found.
 */
export async function getLatestRelease(
  owner,
  repo,
  { prefix, quiet = false } = {},
) {
  const cacheKey = `latest-release:${owner}/${repo}:${prefix || 'latest'}`

  return await cache.getOrFetch(cacheKey, async () => {
    return await pRetry(
      async () => {
        const response = await httpRequest(
          `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
          {
            headers: getAuthHeaders(),
          },
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch releases: ${response.status}`)
        }

        let releases
        try {
          releases = JSON.parse(response.body)
        } catch (e) {
          throw new Error(
            `Failed to parse GitHub API response: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        // If no prefix specified, return the first (latest) release.
        if (!prefix) {
          if (!releases.length) {
            if (!quiet) {
              logger.info(`  No releases found for ${owner}/${repo}`)
            }
            return null
          }
          const tag = releases[0].tag_name
          if (!quiet) {
            logger.info(`  Found latest release: ${tag}`)
          }
          return tag
        }

        // Find the first release matching the prefix.
        for (const release of releases) {
          const { tag_name: tag } = release
          if (tag.startsWith(`${prefix}-`)) {
            if (!quiet) {
              logger.info(`  Found release: ${tag}`)
            }
            return tag
          }
        }

        // No matching release found in the list.
        if (!quiet) {
          logger.info(`  No ${prefix} release found in latest 100 releases`)
        }
        return null
      },
      {
        backoffFactor: 2,
        baseDelayMs: 3_000,
        onRetry: (attempt, error) => {
          if (!quiet) {
            logger.info(
              `  Retry attempt ${attempt + 1}/3 for ${owner}/${repo} release list...`,
            )
            logger.warn(`  Attempt ${attempt + 1}/3 failed: ${error.message}`)
          }
        },
        retries: 2,
      },
    )
  })
}

/**
 * Get download URL for a specific release asset.
 *
 * Returns the browser download URL which requires redirect following.
 * For public repositories, this URL returns HTTP 302 redirect to CDN.
 *
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} tag - Release tag name.
 * @param {string} assetName - Asset name to download.
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Download URL or null if not found.
 */
export async function getReleaseAssetUrl(
  owner,
  repo,
  tag,
  assetName,
  { quiet = false } = {},
) {
  const cacheKey = `asset-url:${owner}/${repo}:${tag}:${assetName}`

  return await cache.getOrFetch(cacheKey, async () => {
    return await pRetry(
      async () => {
        const response = await httpRequest(
          `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
          {
            headers: getAuthHeaders(),
          },
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch release ${tag}: ${response.status}`)
        }

        let release
        try {
          release = JSON.parse(response.body)
        } catch (e) {
          throw new Error(
            `Failed to parse GitHub release ${tag}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        // Find the matching asset.
        const asset = release.assets.find(a => a.name === assetName)

        if (!asset) {
          throw new Error(`Asset ${assetName} not found in release ${tag}`)
        }

        if (!quiet) {
          logger.info(`  Found asset: ${assetName}`)
        }

        return asset.browser_download_url
      },
      {
        backoffFactor: 2,
        baseDelayMs: 3_000,
        onRetry: (attempt, error) => {
          if (!quiet) {
            logger.info(`  Retry attempt ${attempt + 1}/3 for asset URL...`)
            logger.warn(`  Attempt ${attempt + 1}/3 failed: ${error.message}`)
          }
        },
        retries: 2,
      },
    )
  })
}
