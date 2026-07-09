/**
 * Unit tests for GitHub API retry logic.
 *
 * Purpose: Tests withGitHubRetry's exponential backoff and retry-vs-fail
 * classification against categorized GitHub errors.
 *
 * Related Files: - src/util/git/github.mts (implementation) -
 * src/commands/scan/create-scan-from-github.mts (consumer) -
 * src/util/git/github-provider.mts (consumer)
 */

import { RequestError } from '@octokit/request-error'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withGitHubRetry } from '../../../../src/util/git/github.mts'

// Mock debug utilities to suppress output during tests.
vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
  debugDirNs: vi.fn(),
  debugNs: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/debug/namespace'), () => ({
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
