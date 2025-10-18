/**
 * @fileoverview Network operation helpers for build scripts
 *
 * Shared utilities for downloading files, checking connectivity, and handling
 * network operations with retry logic and progress tracking.
 *
 * Used by:
 * - build-yao-pkg-node.mjs (downloading Node.js, patches)
 * - build-sea.mjs (downloading Node.js binaries)
 * - Other build scripts requiring network operations
 */

import { writeFile } from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'

/**
 * Download file with automatic retry and optional progress tracking.
 *
 * @param {string} url - URL to download
 * @param {string} destination - Local file path to save to
 * @param {Object} [options] - Download options
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {number} [options.retryDelay=2000] - Base delay between retries (ms)
 * @param {Function} [options.onProgress] - Progress callback (downloaded, total, percent)
 * @param {Function} [options.verifyIntegrity] - Integrity verification function
 * @param {number} [options.timeout=30000] - Request timeout in milliseconds
 * @returns {Promise<{success: boolean, size: number}>} Download result
 *
 * @throws {Error} If download fails after all retries
 *
 * @example
 * const result = await downloadWithRetry(
 *   'https://example.com/file.tar.gz',
 *   '/tmp/file.tar.gz',
 *   {
 *     onProgress: ({downloaded, total, percent}) => {
 *       logger.log(`Downloaded ${percent.toFixed(1)}%`)
 *     }
 *   }
 * )
 */
export async function downloadWithRetry(url, destination, options = {}) {
  const {
    maxRetries = 3,
    onProgress = null,
    retryDelay = 2000,
    timeout = 30_000,
    verifyIntegrity = null,
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(url, { signal: controller.signal })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const contentLength = response.headers.get('content-length')
        const buffer = await streamWithProgress(
          response,
          contentLength,
          onProgress,
        )

        if (verifyIntegrity) {
          await verifyIntegrity(buffer)
        }

        await writeFile(destination, buffer)

        return { success: true, size: buffer.length }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (e) {
      const isLastAttempt = attempt === maxRetries

      if (isLastAttempt) {
        throw new Error(
          `Download failed after ${maxRetries} attempts: ${e.message}`,
        )
      }

      // Exponential backoff: 2s, 4s, 8s, etc.
      const delay = retryDelay * attempt
      logger.log(
        `Download attempt ${attempt} failed: ${e.message}. Retrying in ${delay}ms...`,
      )

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

/**
 * Check network connectivity to a host.
 *
 * @param {string} host - Hostname to check (without protocol)
 * @param {number} [timeout=5000] - Timeout in milliseconds
 * @returns {Promise<boolean>} True if host is reachable
 *
 * @example
 * const canReach = await checkConnectivity('github.com')
 * if (!canReach) {
 *   logger.error('Cannot reach GitHub')
 * }
 */
export async function checkConnectivity(host, timeout = 5000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`https://${host}`, {
      method: 'HEAD',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetch JSON data with retry logic.
 *
 * @param {string} url - URL to fetch JSON from
 * @param {Object} [options] - Fetch options
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {number} [options.retryDelay=2000] - Base delay between retries (ms)
 * @param {number} [options.timeout=10000] - Request timeout in milliseconds
 * @returns {Promise<any>} Parsed JSON data
 *
 * @throws {Error} If fetch fails after all retries
 *
 * @example
 * const releases = await fetchJsonWithRetry('https://nodejs.org/dist/index.json')
 */
export async function fetchJsonWithRetry(url, options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 2000,
    timeout = 10_000,
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(url, { signal: controller.signal })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        return await response.json()
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (e) {
      const isLastAttempt = attempt === maxRetries

      if (isLastAttempt) {
        throw new Error(
          `JSON fetch failed after ${maxRetries} attempts: ${e.message}`,
        )
      }

      const delay = retryDelay * attempt
      logger.log(
        `Fetch attempt ${attempt} failed: ${e.message}. Retrying in ${delay}ms...`,
      )

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

/**
 * Stream response body with progress tracking.
 *
 * @private
 * @param {Response} response - Fetch response object
 * @param {string|null} contentLength - Content-Length header value
 * @param {Function|null} onProgress - Progress callback
 * @returns {Promise<Buffer>} Downloaded data as Buffer
 */
async function streamWithProgress(response, contentLength, onProgress) {
  // Fast path: no progress tracking needed.
  if (!onProgress || !contentLength) {
    return Buffer.from(await response.arrayBuffer())
  }

  const chunks = []
  let downloaded = 0
  const total = Number.parseInt(contentLength, 10)

  const reader = response.body.getReader()

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
    downloaded += value.length

    onProgress({
      downloaded,
      total,
      percent: (downloaded / total) * 100,
    })
  }

  return Buffer.concat(chunks)
}
