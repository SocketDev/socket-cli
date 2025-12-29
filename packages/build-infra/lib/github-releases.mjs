/**
 * Shared utilities for fetching GitHub releases.
 */

import { Octokit } from 'octokit'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pRetry } from '@socketsecurity/lib/promises'

const logger = getDefaultLogger()

const OWNER = 'SocketDev'
const REPO = 'socket-btm'

/**
 * Get latest release tag for a tool with retry logic.
 *
 * @param {string} tool - Tool name (e.g., 'lief', 'binpress').
 * @param {object} [options] - Options.
 * @param {boolean} [options.quiet] - Suppress log messages.
 * @returns {Promise<string|null>} - Latest release tag or null if not found.
 */
export async function getLatestRelease(tool, { quiet = false } = {}) {
  const octokit = new Octokit()

  return await pRetry(
    async () => {
      const { data: releases } = await octokit.rest.repos.listReleases({
        owner: OWNER,
        per_page: 100,
        repo: REPO,
      })

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
  const octokit = new Octokit()

  return await pRetry(
    async () => {
      const { data: release } = await octokit.rest.repos.getReleaseByTag({
        owner: OWNER,
        repo: REPO,
        tag,
      })

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
 * Download a release asset directly using Octokit.
 *
 * Handles GitHub's redirect mechanism automatically via Octokit API.
 * Use this instead of httpDownload + getReleaseAssetUrl to avoid HTTP 302 redirect issues.
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
  const { promises: fs } = await import('node:fs')
  const path = await import('node:path')

  const octokit = new Octokit()

  await pRetry(
    async () => {
      const { data: release } = await octokit.rest.repos.getReleaseByTag({
        owner: OWNER,
        repo: REPO,
        tag,
      })

      // Find the matching asset.
      const asset = release.assets.find(a => a.name === assetName)

      if (!asset) {
        throw new Error(`Asset ${assetName} not found in release ${tag}`)
      }

      if (!quiet) {
        logger.info(`  Found asset: ${assetName}`)
      }

      // Download asset data via Octokit (handles redirects automatically).
      const { data } = await octokit.rest.repos.getReleaseAsset({
        asset_id: asset.id,
        headers: {
          accept: 'application/octet-stream',
        },
        owner: OWNER,
        repo: REPO,
      })

      // Create output directory.
      await safeMkdir(path.dirname(outputPath))

      // Write to file.
      // Octokit returns data as ArrayBuffer, convert to Buffer for Node.js.
      const buffer = Buffer.from(data)
      await fs.writeFile(outputPath, buffer)

      if (!quiet) {
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(2)
        logger.success(`Downloaded ${assetName} (${sizeMB} MB)`)
      }
    },
    {
      backoffFactor: 1,
      baseDelayMs: 5000,
      onRetry: (attempt, error) => {
        if (!quiet) {
          logger.info(`  Retry attempt ${attempt + 1}/3 for asset download...`)
          logger.warn(`  Attempt ${attempt + 1}/3 failed: ${error.message}`)
        }
      },
      retries: 2,
    },
  )
}
