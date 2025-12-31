/**
 * Shared utilities for downloading assets from socket-btm GitHub releases.
 * Provides common patterns for fetching, caching, and extracting release assets.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const SOCKET_BTM_REPO = 'SocketDev/socket-btm'

/**
 * Get GitHub authentication headers for API requests.
 *
 * Constructs HTTP headers for GitHub API v3 requests, including authentication
 * if a token is available via environment variables.
 *
 * Environment Variables:
 * - GH_TOKEN: GitHub personal access token (checked first).
 * - GITHUB_TOKEN: GitHub personal access token (fallback).
 *
 * Token Permissions:
 * - Public repositories: No token required, but recommended to avoid rate limits.
 * - Private repositories: Token with 'repo' scope required.
 *
 * Rate Limits (per hour):
 * - Authenticated: 5,000 requests.
 * - Unauthenticated: 60 requests.
 *
 * @returns {object} - Headers object with Accept, X-GitHub-Api-Version, and optional Authorization.
 *
 * @example
 * const headers = getAuthHeaders()
 * const response = await httpRequest('https://api.github.com/repos/...', { headers })
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
 * Fetch releases from socket-btm GitHub repository.
 *
 * @throws {Error} When releases cannot be fetched or API errors occur.
 */
async function fetchReleases() {
  const response = await httpRequest(
    `https://api.github.com/repos/${SOCKET_BTM_REPO}/releases`,
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
      `Failed to fetch releases: ${response.status} ${response.statusText || response.status}`,
    )
  }

  return JSON.parse(response.body)
}

/**
 * Find the latest release matching a tag prefix.
 *
 * @param {string} tagPrefix - Tag prefix to search for (e.g., 'yoga-layout-')
 * @param {string} [envVar] - Environment variable name for override
 * @returns {Promise<{tag: string, release: object} | null>}
 * @throws {Error} When API errors occur during release fetching.
 */
export async function getLatestRelease(tagPrefix, envVar) {
  // Check for environment variable override.
  if (envVar) {
    const envTag = process.env[envVar]
    if (envTag) {
      logger.info(`Using ${envVar}: ${envTag}`)
      try {
        const response = await httpRequest(
          `https://api.github.com/repos/${SOCKET_BTM_REPO}/releases/tags/${envTag}`,
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

          logger.warn(
            `Failed to fetch release for ${envVar}=${envTag} (${response.status}), falling back to auto-detect`,
          )
        } else {
          return {
            release: JSON.parse(response.body),
            tag: envTag,
          }
        }
      } catch (e) {
        logger.warn(
          `Failed to fetch release for ${envVar}=${envTag}, falling back to auto-detect`,
        )
      }
    }
  }

  // Auto-detect latest release.
  const releases = await fetchReleases()
  const matchingRelease = releases.find(r => r.tag_name.startsWith(tagPrefix))
  if (!matchingRelease) {
    return null
  }

  return {
    release: matchingRelease,
    tag: matchingRelease.tag_name,
  }
}

/**
 * Find asset in release by name pattern.
 *
 * @param {object} release - GitHub release object
 * @param {string | RegExp | function} pattern - Asset name pattern
 * @returns {string | null} - Asset name or null
 */
export function findAsset(release, pattern) {
  const matcher =
    typeof pattern === 'function'
      ? pattern
      : typeof pattern === 'string'
        ? a => a.name.includes(pattern)
        : a => pattern.test(a.name)

  const asset = release.assets.find(matcher)
  return asset ? asset.name : null
}

/**
 * Download asset from GitHub release with caching.
 *
 * @param {object} options - Download options
 * @param {string} options.tag - Release tag
 * @param {string} options.assetName - Asset filename
 * @param {string} options.cacheDir - Cache directory path
 * @returns {Promise<string>} - Path to cached file
 */
export async function downloadAsset({ assetName, cacheDir, tag }) {
  await mkdir(cacheDir, { recursive: true })

  const cachedPath = path.join(cacheDir, assetName)
  const downloadUrl = `https://github.com/${SOCKET_BTM_REPO}/releases/download/${tag}/${assetName}`

  if (!existsSync(cachedPath)) {
    logger.info(`Downloading ${assetName} from socket-btm...`)
    const response = await httpRequest(downloadUrl)
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }
    await writeFile(cachedPath, response.body)

    // TODO: Verify SHA256 checksum against release asset checksum.
    // GitHub releases can include checksum files (e.g., SHA256SUMS) to verify integrity.
    // Implementation should:
    // 1. Check if a checksum file exists for this release (e.g., SHA256SUMS.txt).
    // 2. Download and parse the checksum file.
    // 3. Compute SHA256 hash of the downloaded asset using computeFileHash().
    // 4. Compare computed hash with expected hash from checksum file.
    // 5. Throw error if hashes do not match.
    logger.info('Note: Checksum verification not yet implemented for downloaded assets.')

    logger.success(`Downloaded ${assetName}`)
  } else {
    logger.info(`Using cached ${assetName}`)
  }

  return cachedPath
}

/**
 * Compute SHA256 hash of file content.
 *
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} - Hex-encoded SHA256 hash
 */
export async function computeFileHash(filePath) {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Check if cached file is up to date by comparing hashes.
 *
 * @param {string} sourcePath - Path to source file
 * @param {string} outputPath - Path to output file
 * @param {function} [validateOutput] - Optional output validation function
 * @returns {Promise<boolean>} - True if extraction needed
 */
export async function needsExtraction(sourcePath, outputPath, validateOutput) {
  if (!existsSync(outputPath)) {
    return true
  }

  // Validate output if function provided.
  if (validateOutput) {
    try {
      const outputContent = await readFile(outputPath, 'utf-8')
      if (!validateOutput(outputContent)) {
        return true
      }
    } catch {
      return true
    }
  }

  // Compare hashes.
  const sourceHash = await computeFileHash(sourcePath)
  const outputContent = await readFile(outputPath, 'utf-8')
  const hashMatch = outputContent.match(/Source hash: ([a-f0-9]{64})/)

  if (!hashMatch || hashMatch[1] !== sourceHash) {
    return true
  }

  return false
}

/**
 * Generate file header with metadata.
 *
 * @param {object} options - Header options
 * @param {string} options.scriptName - Name of generating script
 * @param {string} options.tag - Release tag
 * @param {string} options.assetName - Asset filename
 * @param {string} [options.sourceHash] - Optional source hash
 * @returns {string} - File header comment
 */
export function generateHeader({ assetName, scriptName, sourceHash, tag }) {
  const hashLine = sourceHash ? `\n * Source hash: ${sourceHash}` : ''

  return `/**
 * AUTO-GENERATED by ${scriptName}
 * DO NOT EDIT MANUALLY - changes will be overwritten on next build.
 *
 * Source: socket-btm GitHub releases (${tag})
 * Asset: ${assetName}${hashLine}
 */`
}

/**
 * Get cache directory for a specific asset type.
 *
 * @param {string} name - Cache directory name
 * @param {string} rootPath - Project root path
 * @returns {string} - Full cache directory path
 */
export function getCacheDir(name, rootPath) {
  return path.join(rootPath, 'build', '.cache', name)
}
