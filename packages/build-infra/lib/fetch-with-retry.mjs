/**
 * Fetch with exponential backoff retry logic.
 * Automatically retries on network errors and 5xx server errors.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

/**
 * Fetch with automatic retry on transient failures.
 *
 * @param {string} url - URL to fetch
 * @param {RequestInit} [options] - Fetch options
 * @param {object} [retryOptions] - Retry configuration
 * @param {number} [retryOptions.retries=3] - Number of retry attempts
 * @param {number} [retryOptions.initialDelay=1000] - Initial delay in ms
 * @param {number} [retryOptions.maxDelay=30000] - Maximum delay in ms
 * @param {boolean} [retryOptions.silent=false] - Suppress retry logs
 * @returns {Promise<Response>} Fetch response
 * @throws {Error} After all retries exhausted
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    retries = 3,
    initialDelay = 1000,
    maxDelay = 30_000,
    silent = false,
  } = retryOptions

  let lastError

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options)

      // Success!
      if (response.ok) {
        if (attempt > 1 && !silent) {
          getDefaultLogger().log(`✓ Request succeeded on attempt ${attempt}`)
        }
        return response
      }

      // Don't retry client errors (4xx) except these:
      // - 408 Request Timeout
      // - 429 Too Many Requests (rate limiting)
      // - 499 Client Closed Request (nginx)
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 429, 499].includes(response.status)
      ) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}: ${url}`,
        )
      }

      // Server error (5xx) or retryable 4xx - try again.
      lastError = new Error(
        `HTTP ${response.status} ${response.statusText}: ${url}`,
      )

      if (attempt < retries) {
        const delay = Math.min(initialDelay * 2 ** (attempt - 1), maxDelay)
        if (!silent) {
          getDefaultLogger().warn(
            `✗ Attempt ${attempt}/${retries} failed: ${response.status} ${response.statusText}`,
          )
          getDefaultLogger().log(`  Retrying in ${delay}ms...`)
        }
        await sleep(delay)
      }
    } catch (error) {
      lastError = error

      // Don't retry on specific error types.
      if (error instanceof TypeError) {
        // Network error, DNS failure, etc - retry.
        if (attempt < retries) {
          const delay = Math.min(initialDelay * 2 ** (attempt - 1), maxDelay)
          if (!silent) {
            getDefaultLogger().warn(`✗ Attempt ${attempt}/${retries} failed: ${error.message}`)
            getDefaultLogger().log(`  Retrying in ${delay}ms...`)
          }
          await sleep(delay)
          continue
        }
      }

      // Other errors - don't retry.
      throw error
    }
  }

  // All retries exhausted.
  throw new Error(
    `Failed to fetch ${url} after ${retries} attempts: ${lastError.message}`,
  )
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
