/**
 * Shared utilities for fetching GitHub releases.
 */

import { safeMkdir } from '@socketsecurity/lib/fs'
import { httpDownload, httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pRetry } from '@socketsecurity/lib/promises'

const logger = getDefaultLogger()

const OWNER = 'SocketDev'
const REPO = 'socket-btm'

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
 * Get latest release tag for a tool with retry logic.
 *
 * @param {string} tool - Tool name (e.g., 'lief', 'binpress').
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Latest release tag or null if not found.
 */
export async function getLatestRelease(tool, { quiet = false } = {}) {
  return await pRetry(
    async () => {
      const response = await httpRequest(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`,
        {
          headers: getAuthHeaders(),
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch releases: ${response.status}`)
      }

      const releases = JSON.parse(response.body)

      // Find the first release matching the tool prefix.
      for (const release of releases) {
        const { tag_name: tag } = release
        if (tag.startsWith(`${tool}-`)) {
          if (!quiet) {
            logger.info(`  Found release: ${tag}`)
          }
          return tag
        }
      }

      // No matching release found in the list.
      if (!quiet) {
        logger.info(`  No ${tool} release found in latest 100 releases`)
      }
      return null
    },
    {
      backoffFactor: 1,
      baseDelayMs: 5000,
      onRetry: (attempt, error) => {
        if (!quiet) {
          logger.info(
            `  Retry attempt ${attempt + 1}/3 for ${tool} release list...`,
          )
          logger.warn(`  Attempt ${attempt + 1}/3 failed: ${error.message}`)
        }
      },
      retries: 2,
    },
  )
}

/**
 * Get download URL for a specific release asset.
 *
 * Returns the browser download URL which requires redirect following.
 * For public repositories, this URL returns HTTP 302 redirect to CDN.
 *
 * @param {string} tag - Release tag name.
 * @param {string} assetName - Asset name to download.
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Download URL or null if not found.
 */
export async function getReleaseAssetUrl(
  tag,
  assetName,
  { quiet = false } = {},
) {
  return await pRetry(
    async () => {
      const response = await httpRequest(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`,
        {
          headers: getAuthHeaders(),
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch release ${tag}: ${response.status}`)
      }

      const release = JSON.parse(response.body)

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
      backoffFactor: 1,
      baseDelayMs: 5000,
      onRetry: (attempt, error) => {
        if (!quiet) {
          logger.info(`  Retry attempt ${attempt + 1}/3 for asset URL...`)
          logger.warn(`  Attempt ${attempt + 1}/3 failed: ${error.message}`)
        }
      },
      retries: 2,
    },
  )
}

/**
 * Download a specific release asset.
 *
 * Uses browser_download_url to avoid consuming GitHub API quota.
 * The httpDownload function from @socketsecurity/lib@5.1.3+ automatically
 * follows HTTP redirects, eliminating the need for Octokit's getReleaseAsset API.
 *
 * @param {string} tag - Release tag name.
 * @param {string} assetName - Asset name to download.
 * @param {string} outputPath - Path to write the downloaded file.
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<void>}
 */
export async function downloadReleaseAsset(
  tag,
  assetName,
  outputPath,
  { quiet = false } = {},
) {
  const path = await import('node:path')

  // Get the browser_download_url for the asset (doesn't consume API quota for download)
  const downloadUrl = await getReleaseAssetUrl(tag, assetName, { quiet })

  if (!downloadUrl) {
    throw new Error(`Asset ${assetName} not found in release ${tag}`)
  }

  // Create output directory
  await safeMkdir(path.dirname(outputPath))

  // Download using httpDownload which supports redirects and retries
  // This avoids consuming GitHub API quota for the actual download
  await httpDownload(downloadUrl, outputPath, {
    logger: quiet ? undefined : logger,
    progressInterval: 10,
    retries: 2,
    retryDelay: 5000,
  })
}
