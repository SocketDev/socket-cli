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
 * Fetch releases from socket-btm GitHub repository.
 */
async function fetchReleases() {
  const response = await httpRequest(
    `https://api.github.com/repos/${SOCKET_BTM_REPO}/releases`,
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.status}`)
  }
  return JSON.parse(response.body)
}

/**
 * Find the latest release matching a tag prefix.
 *
 * @param {string} tagPrefix - Tag prefix to search for (e.g., 'yoga-layout-')
 * @param {string} [envVar] - Environment variable name for override
 * @returns {Promise<{tag: string, release: object} | null>}
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
        )
        if (response.ok) {
          return {
            release: JSON.parse(response.body),
            tag: envTag,
          }
        }
      } catch {
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
