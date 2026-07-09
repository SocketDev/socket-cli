/**
 * GitHub API error handling for Socket CLI. Converts GitHub REST/GraphQL
 * errors into user-friendly CResult failures with actionable messages, and
 * provides a retry wrapper for transient failures.
 */
import { GraphqlResponseError } from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'

import { debugDirNs, debugNs } from '@socketsecurity/lib-stable/debug/output'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { isError } from '@socketsecurity/lib-stable/errors/predicates'

import { formatErrorWithDetail } from '../error/errors.mts'

import type { CResult } from '../../types.mts'

// Canonical `message` values returned by `handleGitHubApiError` /
// `handleGraphqlError`. Exported so callers can short-circuit on
// blocking conditions without matching free-form strings.
export const GITHUB_ERR_ABUSE_DETECTION = 'GitHub abuse detection triggered'
export const GITHUB_ERR_AUTH_FAILED = 'GitHub authentication failed'
export const GITHUB_ERR_GRAPHQL_RATE_LIMIT =
  'GitHub GraphQL rate limit exceeded'
export const GITHUB_ERR_RATE_LIMIT = 'GitHub rate limit exceeded'

/**
 * Convert GitHub API errors to user-friendly CResult failures. Handles rate
 * limits, authentication, and network errors with actionable messages.
 */
export function handleGitHubApiError(
  e: unknown,
  context: string,
): CResult<never> {
  debugNs('error', formatErrorWithDetail(`GitHub API error: ${context}`, e))
  debugDirNs('error', e)

  if (e instanceof RequestError) {
    const { status } = e

    // Abuse detection rate limit - check first since it's more specific than standard rate limit.
    if (status === 403 && e.message.includes('secondary rate limit')) {
      return {
        ok: false,
        message: GITHUB_ERR_ABUSE_DETECTION,
        cause:
          `GitHub abuse detection triggered while ${context}. ` +
          'This happens when making too many requests in a short period. ' +
          'Wait a few minutes before retrying.\n\n' +
          'To avoid this:\n' +
          '- Reduce the number of concurrent operations\n' +
          '- Add delays between bulk operations',
      }
    }

    // Standard rate limit errors (403 with rate limit message or 429).
    if (
      status === 429 ||
      (status === 403 && e.message.includes('rate limit'))
    ) {
      const retryAfter = e.response?.headers?.['retry-after']
      const resetHeader = e.response?.headers?.['x-ratelimit-reset']
      let waitTime: number | undefined

      if (retryAfter) {
        waitTime = Number.parseInt(String(retryAfter), 10)
        if (Number.isNaN(waitTime) || waitTime < 0) {
          waitTime = undefined
        }
      } else if (resetHeader) {
        const resetTimestamp = Number.parseInt(String(resetHeader), 10)
        if (!Number.isNaN(resetTimestamp)) {
          waitTime = Math.max(0, resetTimestamp - Math.floor(Date.now() / 1000))
        }
      }

      return {
        ok: false,
        message: GITHUB_ERR_RATE_LIMIT,
        cause:
          `GitHub API rate limit exceeded while ${context}. ` +
          (waitTime
            ? `Try again in ${waitTime} seconds.`
            : 'Try again in a few minutes.') +
          '\n\n' +
          'To increase your rate limit:\n' +
          '- Set GITHUB_TOKEN environment variable with a valid token\n' +
          '- In GitHub Actions, GITHUB_TOKEN is automatically available\n' +
          '- Personal access tokens provide higher rate limits than unauthenticated requests',
      }
    }

    // Authentication errors.
    if (status === 401) {
      return {
        ok: false,
        message: GITHUB_ERR_AUTH_FAILED,
        cause:
          `GitHub authentication failed while ${context}. ` +
          'Your token may be invalid, expired, or missing required permissions.\n\n' +
          'To resolve:\n' +
          '- Verify your GitHub token is valid and not expired\n' +
          '- Set GITHUB_TOKEN environment variable\n' +
          '- Ensure the token has required scopes (repo, read:org)',
      }
    }

    // Permission denied (valid token but insufficient permissions).
    if (status === 403 && !e.message.includes('rate limit')) {
      return {
        ok: false,
        message: 'GitHub permission denied',
        cause:
          `GitHub permission denied while ${context}. ` +
          'Your token does not have access to this resource.\n\n' +
          'Ensure your token has the required scopes:\n' +
          '- repo: Full control of private repositories\n' +
          '- read:org: Read org membership (for org repos)',
      }
    }

    // Not found errors.
    if (status === 404) {
      return {
        ok: false,
        message: 'GitHub resource not found',
        cause:
          `GitHub resource not found while ${context}. ` +
          'The repository, branch, or file may not exist, or you may not have access to it.\n\n' +
          'Verify:\n' +
          '- The repository name and owner are correct\n' +
          '- The branch exists\n' +
          '- Your token has access to the repository',
      }
    }

    // Server errors (5xx).
    if (status >= 500) {
      return {
        ok: false,
        message: 'GitHub server error',
        cause:
          `GitHub server error (${status}) while ${context}. ` +
          'GitHub may be experiencing issues.\n\n' +
          'To resolve:\n' +
          '- Check https://www.githubstatus.com for service status\n' +
          '- Try again in a few moments',
      }
    }

    // Other request errors.
    return {
      ok: false,
      message: `GitHub API error (${status})`,
      cause: `GitHub API error while ${context}: ${e.message}`,
    }
  }

  // Network errors (ECONNREFUSED, ETIMEDOUT, etc.).
  if (isError(e)) {
    const code = (e as NodeJS.ErrnoException).code
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT'
    ) {
      return {
        ok: false,
        message: 'Network error connecting to GitHub',
        cause:
          `Network error while ${context}: ${e.message}\n\n` +
          'To resolve:\n' +
          '- Check your internet connection\n' +
          '- Verify GitHub API is accessible from your network\n' +
          '- Check if a proxy or firewall is blocking the connection',
      }
    }
  }

  // Generic fallback.
  return {
    ok: false,
    message: 'GitHub API error',
    cause: `Unexpected error while ${context}: ${errorMessage(e)}`,
  }
}

/**
 * Convert GraphQL errors to user-friendly CResult failures. Handles rate limits
 * and authentication errors with actionable messages.
 */
export function handleGraphqlError(
  e: unknown,
  context: string,
): CResult<never> {
  debugNs('error', formatErrorWithDetail(`GraphQL error: ${context}`, e))
  debugDirNs('error', e)

  if (e instanceof GraphqlResponseError) {
    const errorMessages = Array.isArray(e.errors)
      ? e.errors.map(err => err.message).filter(Boolean)
      : []

    // Check for rate limit errors.
    if (isGraphqlRateLimitError(e)) {
      return {
        ok: false,
        message: GITHUB_ERR_GRAPHQL_RATE_LIMIT,
        cause:
          `GitHub GraphQL rate limit exceeded while ${context}. ` +
          'Try again in a few minutes.\n\n' +
          'To increase your rate limit:\n' +
          '- Set GITHUB_TOKEN environment variable with a valid token\n' +
          '- In GitHub Actions, GITHUB_TOKEN is automatically available',
      }
    }

    // Return the GraphQL error details.
    return {
      ok: false,
      message: 'GitHub GraphQL error',
      cause:
        `GitHub GraphQL error while ${context}` +
        (errorMessages.length ? `:\n- ${errorMessages.join('\n- ')}` : ''),
    }
  }

  // Fall back to REST error handler for non-GraphQL errors.
  return handleGitHubApiError(e, context)
}

/**
 * Check if a GraphQL error is a rate limit error.
 */
export function isGraphqlRateLimitError(e: unknown): boolean {
  if (e instanceof GraphqlResponseError && Array.isArray(e.errors)) {
    return e.errors.some(
      err =>
        err.type === 'RATE_LIMITED' ||
        err.message?.toLowerCase().includes('rate limit'),
    )
  }
  return false
}

/**
 * Execute a GitHub API call with retry logic for transient failures. Retries on
 * 5xx errors and network failures with exponential backoff.
 */
export async function withGitHubRetry<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = 3,
): Promise<CResult<T>> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation()
      return { ok: true, data: result }
    } catch (e) {
      lastError = e
      debugNs(
        'notice',
        `GitHub API attempt ${attempt}/${maxRetries} failed for ${context}`,
      )
      debugDirNs('error', e)

      // Don't retry on client errors (4xx) except rate limits.
      if (e instanceof RequestError) {
        const { status } = e
        // Rate limits: return immediately with helpful message.
        if (
          status === 429 ||
          (status === 403 && e.message.includes('rate limit'))
        ) {
          return handleGitHubApiError(e, context)
        }
        // Don't retry other 4xx errors.
        if (status >= 400 && status < 500) {
          return handleGitHubApiError(e, context)
        }
      }

      // Retry on 5xx or network errors.
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000)
        debugNs('notice', `Retrying in ${delay}ms…`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  return handleGitHubApiError(lastError, context)
}
