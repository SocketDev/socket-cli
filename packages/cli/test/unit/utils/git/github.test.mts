/**
 * Unit tests for GitHub API utilities.
 *
 * Purpose:
 * Tests centralized GitHub API error handling and retry logic used across the CLI.
 * Validates proper error categorization, user-friendly messages, and exponential backoff.
 *
 * Test Coverage:
 * - handleGitHubApiError: error categorization by HTTP status
 * - handleGraphqlError: GraphQL-specific error handling
 * - isGraphqlRateLimitError: rate limit detection
 * - withGitHubRetry: retry logic with exponential backoff
 *
 * Testing Approach:
 * Creates mock RequestError and GraphqlResponseError objects to test error handling
 * without actual GitHub API calls. Tests verify proper error messages and retry behavior.
 *
 * Related Files:
 * - src/utils/git/github.mts (implementation)
 * - src/commands/scan/create-scan-from-github.mts (consumer)
 * - src/utils/git/github-provider.mts (consumer)
 */

import { GraphqlResponseError } from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  handleGitHubApiError,
  handleGraphqlError,
  isGraphqlRateLimitError,
  withGitHubRetry,
} from '../../../../src/utils/git/github.mts'

// Mock debug utilities to suppress output during tests.
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugDirNs: vi.fn(),
  debugNs: vi.fn(),
  isDebugNs: vi.fn(() => false),
}))

// Helper to create a RequestError with specific status.
function createRequestError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): RequestError {
  const error = new RequestError(message, status, {
    request: { method: 'GET', url: 'https://api.github.com/test', headers: {} },
    response: {
      status,
      url: 'https://api.github.com/test',
      headers,
      data: {},
    },
  })
  return error
}

// Helper to create a GraphqlResponseError.
function createGraphqlError(
  errors: Array<{ type?: string; message: string }>,
): GraphqlResponseError<unknown> {
  return new GraphqlResponseError(
    { method: 'POST', url: 'https://api.github.com/graphql' },
    { 'x-request-id': 'test' },
    { data: null, errors },
  )
}

describe('handleGitHubApiError', () => {
  describe('rate limit errors', () => {
    it('handles 429 rate limit error', () => {
      const error = createRequestError(429, 'API rate limit exceeded')
      const result = handleGitHubApiError(error, 'fetching commits')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub rate limit exceeded')
      expect(result.cause).toContain('rate limit exceeded')
      expect(result.cause).toContain('fetching commits')
      expect(result.cause).toContain('GITHUB_TOKEN')
    })

    it('handles 403 with rate limit message', () => {
      const error = createRequestError(
        403,
        'API rate limit exceeded for user ID 12345',
      )
      const result = handleGitHubApiError(error, 'listing repos')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub rate limit exceeded')
      expect(result.cause).toContain('listing repos')
    })

    it('includes retry-after header in message when present', () => {
      const error = createRequestError(429, 'Rate limit exceeded', {
        'retry-after': '60',
      })
      const result = handleGitHubApiError(error, 'fetching data')

      expect(result.ok).toBe(false)
      expect(result.cause).toContain('60 seconds')
    })

    it('includes x-ratelimit-reset header in message', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120
      const error = createRequestError(429, 'Rate limit exceeded', {
        'x-ratelimit-reset': String(futureTimestamp),
      })
      const result = handleGitHubApiError(error, 'fetching data')

      expect(result.ok).toBe(false)
      // Should show approximate wait time.
      expect(result.cause).toMatch(/Try again in \d+ seconds/)
    })
  })

  describe('abuse detection', () => {
    it('handles abuse detection rate limit', () => {
      const error = createRequestError(
        403,
        'You have exceeded a secondary rate limit',
      )
      const result = handleGitHubApiError(error, 'bulk operation')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub abuse detection triggered')
      expect(result.cause).toContain('abuse detection')
      expect(result.cause).toContain('bulk operation')
    })

    it('differentiates abuse detection from standard rate limit', () => {
      // Standard rate limit.
      const standardError = createRequestError(
        403,
        'API rate limit exceeded for user',
      )
      const standardResult = handleGitHubApiError(standardError, 'operation')
      expect(standardResult.message).toBe('GitHub rate limit exceeded')

      // Abuse detection (has "secondary rate limit" in message from GitHub).
      const abuseError = createRequestError(
        403,
        'You have exceeded a secondary rate limit',
      )
      const abuseResult = handleGitHubApiError(abuseError, 'operation')
      expect(abuseResult.message).toBe('GitHub abuse detection triggered')
    })
  })

  describe('authentication errors', () => {
    it('handles 401 authentication error', () => {
      const error = createRequestError(401, 'Bad credentials')
      const result = handleGitHubApiError(error, 'creating PR')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub authentication failed')
      expect(result.cause).toContain('authentication failed')
      expect(result.cause).toContain('creating PR')
      expect(result.cause).toContain('token')
    })
  })

  describe('permission errors', () => {
    it('handles 403 permission denied (not rate limit)', () => {
      const error = createRequestError(
        403,
        'Resource not accessible by integration',
      )
      const result = handleGitHubApiError(error, 'accessing private repo')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub permission denied')
      expect(result.cause).toContain('permission denied')
      expect(result.cause).toContain('accessing private repo')
    })
  })

  describe('not found errors', () => {
    it('handles 404 not found error', () => {
      const error = createRequestError(404, 'Not Found')
      const result = handleGitHubApiError(error, 'fetching repo details')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub resource not found')
      expect(result.cause).toContain('not found')
      expect(result.cause).toContain('fetching repo details')
    })
  })

  describe('server errors', () => {
    it('handles 500 server error', () => {
      const error = createRequestError(500, 'Internal Server Error')
      const result = handleGitHubApiError(error, 'creating scan')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub server error')
      expect(result.cause).toContain('server error')
      expect(result.cause).toContain('500')
      expect(result.cause).toContain('githubstatus.com')
    })

    it('handles 502 bad gateway error', () => {
      const error = createRequestError(502, 'Bad Gateway')
      const result = handleGitHubApiError(error, 'fetching tree')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub server error')
    })

    it('handles 503 service unavailable error', () => {
      const error = createRequestError(503, 'Service Unavailable')
      const result = handleGitHubApiError(error, 'listing commits')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub server error')
    })
  })

  describe('network errors', () => {
    it('handles ECONNREFUSED error', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:443') as NodeJS.ErrnoException
      error.code = 'ECONNREFUSED'
      const result = handleGitHubApiError(error, 'connecting to API')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Network error connecting to GitHub')
      expect(result.cause).toContain('connecting to API')
      expect(result.cause).toContain('internet connection')
    })

    it('handles ETIMEDOUT error', () => {
      const error = new Error('connect ETIMEDOUT') as NodeJS.ErrnoException
      error.code = 'ETIMEDOUT'
      const result = handleGitHubApiError(error, 'fetching data')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Network error connecting to GitHub')
    })

    it('handles ENOTFOUND error', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.github.com') as NodeJS.ErrnoException
      error.code = 'ENOTFOUND'
      const result = handleGitHubApiError(error, 'resolving host')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Network error connecting to GitHub')
    })
  })

  describe('generic errors', () => {
    it('handles unknown RequestError status', () => {
      const error = createRequestError(418, "I'm a teapot")
      const result = handleGitHubApiError(error, 'brewing coffee')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub API error (418)')
      expect(result.cause).toContain("I'm a teapot")
    })

    it('handles non-Error objects', () => {
      const result = handleGitHubApiError('string error', 'doing something')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub API error')
      expect(result.cause).toContain('string error')
    })

    it('handles generic Error objects', () => {
      const error = new Error('Something went wrong')
      const result = handleGitHubApiError(error, 'processing request')

      expect(result.ok).toBe(false)
      expect(result.message).toBe('GitHub API error')
      expect(result.cause).toContain('Something went wrong')
    })
  })
})

describe('isGraphqlRateLimitError', () => {
  it('returns true for RATE_LIMITED type', () => {
    const error = createGraphqlError([
      { type: 'RATE_LIMITED', message: 'API rate limit exceeded' },
    ])
    expect(isGraphqlRateLimitError(error)).toBe(true)
  })

  it('returns true for rate limit message', () => {
    const error = createGraphqlError([
      { message: 'API rate limit exceeded for user' },
    ])
    expect(isGraphqlRateLimitError(error)).toBe(true)
  })

  it('returns false for other GraphQL errors', () => {
    const error = createGraphqlError([
      { type: 'NOT_FOUND', message: 'Resource not found' },
    ])
    expect(isGraphqlRateLimitError(error)).toBe(false)
  })

  it('returns false for non-GraphQL errors', () => {
    const error = new Error('Regular error')
    expect(isGraphqlRateLimitError(error)).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(isGraphqlRateLimitError(null)).toBe(false)
    expect(isGraphqlRateLimitError(undefined)).toBe(false)
  })
})

describe('handleGraphqlError', () => {
  it('handles GraphQL rate limit error', () => {
    const error = createGraphqlError([
      { type: 'RATE_LIMITED', message: 'API rate limit exceeded' },
    ])
    const result = handleGraphqlError(error, 'fetching advisories')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('GitHub GraphQL rate limit exceeded')
    expect(result.cause).toContain('fetching advisories')
    expect(result.cause).toContain('GITHUB_TOKEN')
  })

  it('handles generic GraphQL error', () => {
    const error = createGraphqlError([
      { type: 'FORBIDDEN', message: 'Must have admin rights' },
    ])
    const result = handleGraphqlError(error, 'enabling auto-merge')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('GitHub GraphQL error')
    expect(result.cause).toContain('enabling auto-merge')
    expect(result.cause).toContain('Must have admin rights')
  })

  it('handles multiple GraphQL errors', () => {
    const error = createGraphqlError([
      { message: 'First error' },
      { message: 'Second error' },
    ])
    const result = handleGraphqlError(error, 'complex operation')

    expect(result.ok).toBe(false)
    expect(result.cause).toContain('First error')
    expect(result.cause).toContain('Second error')
  })

  it('falls back to REST handler for non-GraphQL errors', () => {
    const error = createRequestError(500, 'Server Error')
    const result = handleGraphqlError(error, 'api call')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('GitHub server error')
  })
})

describe('withGitHubRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns success on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue({ data: 'test' })
    const resultPromise = withGitHubRetry(operation, 'test operation')
    const result = await resultPromise

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ data: 'test' })
    }
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries on 5xx errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(createRequestError(500, 'Server Error'))
      .mockRejectedValueOnce(createRequestError(502, 'Bad Gateway'))
      .mockResolvedValue({ data: 'success' })

    const resultPromise = withGitHubRetry(operation, 'retry test')

    // Advance through retry delays.
    await vi.advanceTimersByTimeAsync(1000) // First retry delay.
    await vi.advanceTimersByTimeAsync(2000) // Second retry delay.

    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 4xx errors (except rate limits)', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(404, 'Not Found'))

    const result = await withGitHubRetry(operation, 'no retry test')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('GitHub resource not found')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('returns rate limit error immediately without retrying', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(429, 'Rate limit exceeded'))

    const result = await withGitHubRetry(operation, 'rate limit test')

    expect(result.ok).toBe(false)
    expect(result.message).toBe('GitHub rate limit exceeded')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('returns error after exhausting retries', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(500, 'Persistent server error'))

    const resultPromise = withGitHubRetry(operation, 'exhaust retries', 3)

    // Advance through all retry delays.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)

    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(result.message).toBe('GitHub server error')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('uses exponential backoff', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(createRequestError(500, 'Error'))
      .mockRejectedValueOnce(createRequestError(500, 'Error'))
      .mockRejectedValueOnce(createRequestError(500, 'Error'))
      .mockResolvedValue({ data: 'success' })

    const startTime = Date.now()
    const resultPromise = withGitHubRetry(operation, 'backoff test', 4)

    // First retry after 1s.
    await vi.advanceTimersByTimeAsync(1000)
    expect(operation).toHaveBeenCalledTimes(2)

    // Second retry after 2s.
    await vi.advanceTimersByTimeAsync(2000)
    expect(operation).toHaveBeenCalledTimes(3)

    // Third retry after 4s.
    await vi.advanceTimersByTimeAsync(4000)
    expect(operation).toHaveBeenCalledTimes(4)

    const result = await resultPromise
    expect(result.ok).toBe(true)
  })

  it('respects custom max retries', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(500, 'Server Error'))

    const resultPromise = withGitHubRetry(operation, 'custom retries', 5)

    // Advance through 4 retry delays (5 attempts total).
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(4000)
    await vi.advanceTimersByTimeAsync(8000)

    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(operation).toHaveBeenCalledTimes(5)
  })

  it('handles network errors with retry', async () => {
    const networkError = new Error('ETIMEDOUT') as NodeJS.ErrnoException
    networkError.code = 'ETIMEDOUT'

    const operation = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue({ data: 'recovered' })

    const resultPromise = withGitHubRetry(operation, 'network retry')

    await vi.advanceTimersByTimeAsync(1000)

    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
