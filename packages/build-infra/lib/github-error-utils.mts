/**
 * @fileoverview Utilities for detecting and reporting GitHub infrastructure errors.
 *
 * This module provides helpers to identify transient GitHub errors (502, 503, etc.)
 * and fetch GitHub status to help users understand if the issue is temporary.
 */

import { httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Error patterns that indicate transient network/infrastructure issues.
 * These typically resolve on retry.
 */
const TRANSIENT_ERROR_PATTERNS = [
  /HTTP\s+(?:408|429|5\d{2})/i,
  /Bad Gateway/i,
  /Service Unavailable/i,
  /Gateway Timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
]

/**
 * Extract error message from various error types.
 * @param {Error|string|unknown} error - The error to extract message from.
 * @returns {string} The error message.
 */
function getErrorMessage(error) {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  return error?.message || 'Unknown error'
}

/**
 * Check if an error indicates a transient GitHub/network issue.
 * @param {Error|string|unknown} error - The error to check.
 * @returns {boolean} True if the error appears to be transient.
 */
export function isTransientError(error) {
  const message = getErrorMessage(error)
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Fetch GitHub status and return a human-readable summary.
 * @returns {Promise<{status: string, description: string, url: string}|undefined>}
 */
export async function checkGitHubStatus() {
  try {
    const response = await httpRequest(
      'https://www.githubstatus.com/api/v2/status.json',
      { timeout: 5000 },
    )
    if (response.ok) {
      const data = await response.json()
      return {
        status: data.status?.indicator || 'unknown',
        description: data.status?.description || 'Unknown status',
        url: 'https://www.githubstatus.com',
      }
    }
  } catch {
    // GitHub status check failed - don't let this block error reporting.
  }
  return undefined
}

/**
 * Log helpful messages about a transient GitHub error.
 * Call this when a GitHub download fails to provide user-friendly guidance.
 *
 * @param {Error} error - The original error.
 * @param {object} [options] - Options.
 * @param {boolean} [options.checkStatus=true] - Whether to check GitHub status.
 * @returns {Promise<void>}
 */
export async function logTransientErrorHelp(
  error,
  { checkStatus = true } = {},
) {
  if (!isTransientError(error)) {
    return
  }

  logger.warn('')
  logger.warn('This appears to be a transient GitHub infrastructure issue.')
  logger.warn(
    'GitHub Releases CDN occasionally returns 502/503 errors during high load.',
  )

  if (checkStatus) {
    const ghStatus = await checkGitHubStatus()
    if (ghStatus) {
      const statusLabel =
        ghStatus.status === 'none'
          ? 'operational'
          : ghStatus.status === 'minor'
            ? 'degraded'
            : 'major issue'
      logger.warn(`GitHub Status: ${statusLabel} - ${ghStatus.description}`)
      logger.warn(`Check: ${ghStatus.url}`)
    }
  }

  logger.warn('')
  logger.warn('Recommended action: Re-run the CI job.')
  logger.warn(
    'If the issue persists, check https://www.githubstatus.com for outages.',
  )
}
