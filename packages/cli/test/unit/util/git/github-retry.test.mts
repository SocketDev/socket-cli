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
  // The backoff sleeps through `node:timers/promises`, which
  // `vi.useFakeTimers()` does not reliably intercept, so the fake-timer trick
  // cannot make these tests fast. Zeroing the base delay through the env
  // override can, and it exercises the override at the same time. The one test
  // that cares about a specific delay sets the env itself.
  const ENV_KEY = 'SOCKET_GITHUB_RETRY_BASE_DELAY_MS'
  let savedBaseDelay: string | undefined

  beforeEach(() => {
    savedBaseDelay = process.env[ENV_KEY]
    process.env[ENV_KEY] = '0'
  })

  afterEach(() => {
    if (savedBaseDelay === undefined) {
      delete process.env[ENV_KEY]
    } else {
      process.env[ENV_KEY] = savedBaseDelay
    }
  })

  it('returns success on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue({ data: 'test' })

    const result = await withGitHubRetry(operation, 'test operation')

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

    const result = await withGitHubRetry(operation, 'retry test')

    expect(result.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 4xx errors (except rate limits)', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(404, 'Not Found'))

    const result = await withGitHubRetry(operation, 'no retry test')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('GitHub resource not found')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('returns rate limit error immediately without retrying', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(429, 'Rate limit exceeded'))

    const result = await withGitHubRetry(operation, 'rate limit test')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('GitHub rate limit exceeded')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('returns error after exhausting retries', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(500, 'Persistent server error'))

    const result = await withGitHubRetry(operation, 'exhaust retries', 3)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('GitHub server error')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('respects custom max retries', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(500, 'Server Error'))

    const result = await withGitHubRetry(operation, 'custom retries', 5)

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

    const result = await withGitHubRetry(operation, 'network retry')

    expect(result.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('surfaces the failure that ended the run, not an earlier one', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(createRequestError(500, 'Server Error'))
      .mockRejectedValue(createRequestError(404, 'Not Found'))

    const result = await withGitHubRetry(operation, 'last failure wins')

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('GitHub resource not found')
    // The 404 on the second attempt is settled, so the third never runs.
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('honors SOCKET_GITHUB_RETRY_BASE_DELAY_MS for the backoff delay', async () => {
    process.env[ENV_KEY] = '40'
    const operation = vi
      .fn()
      .mockRejectedValue(createRequestError(503, 'Service Unavailable'))

    const started = Date.now()
    const result = await withGitHubRetry(operation, 'env delay', 3)
    const elapsed = Date.now() - started

    expect(result.ok).toBe(false)
    expect(operation).toHaveBeenCalledTimes(3)
    // Two retries at a 40ms base with doubling means at least 40 + 80 ms of
    // real waiting. A zeroed override finishes far below that, so this fails
    // if the env var stops reaching the retry policy.
    expect(elapsed).toBeGreaterThanOrEqual(120)
  })
})
