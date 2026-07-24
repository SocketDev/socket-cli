import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GITHUB_ERR_ABUSE_DETECTION,
  GITHUB_ERR_AUTH_FAILED,
  GITHUB_ERR_RATE_LIMIT,
  classifyGitHubResponse,
  getRateLimitWaitSeconds,
  githubApiRequest,
  isGitHubBlockingError,
} from './github-errors.mts'

function makeResponse(
  status: number,
  headers: Record<string, string> = {},
  body = '',
): Response {
  return new Response(body, { status, headers })
}

type ResponseSpec = {
  status: number
  headers?: Record<string, string>
  body?: string
}

// A fake apiFetch that returns a fresh Response per call from the queued
// specs (a Response body can only be read once, and real apiFetch returns a
// new Response each time). Runs past the end by repeating the last spec. No
// module mocking — passed directly into githubApiRequest's injectable param.
function fakeFetch(specs: ResponseSpec[]): {
  fetchImpl: (url: string, init: unknown) => Promise<Response>
  calls: () => number
} {
  let index = 0
  let calls = 0
  return {
    fetchImpl: () => {
      calls += 1
      const spec = specs[Math.min(index, specs.length - 1)]!
      index += 1
      return Promise.resolve(
        makeResponse(spec.status, spec.headers ?? {}, spec.body ?? ''),
      )
    },
    calls: () => calls,
  }
}

describe('classifyGitHubResponse', () => {
  const ctx = 'fetching repo details for acme/widgets'

  it('flags a 403 with x-ratelimit-remaining: 0 as a rate limit', () => {
    const result = classifyGitHubResponse(
      403,
      new Headers({ 'x-ratelimit-remaining': '0' }),
      '{"message":"API rate limit exceeded"}',
      ctx,
    )
    expect(result?.ok).toBe(false)
    expect(result?.message).toBe(GITHUB_ERR_RATE_LIMIT)
  })

  it('flags a 429 as a rate limit', () => {
    const result = classifyGitHubResponse(429, new Headers(), '', ctx)
    expect(result?.message).toBe(GITHUB_ERR_RATE_LIMIT)
  })

  it('flags a 403 with a rate-limit body message as a rate limit', () => {
    const result = classifyGitHubResponse(
      403,
      new Headers(),
      '{"message":"API rate limit exceeded for user 123."}',
      ctx,
    )
    expect(result?.message).toBe(GITHUB_ERR_RATE_LIMIT)
  })

  it('flags a 403 secondary rate limit as abuse detection', () => {
    const result = classifyGitHubResponse(
      403,
      new Headers(),
      '{"message":"You have exceeded a secondary rate limit."}',
      ctx,
    )
    expect(result?.message).toBe(GITHUB_ERR_ABUSE_DETECTION)
  })

  it('flags a 401 as an auth failure', () => {
    const result = classifyGitHubResponse(401, new Headers(), '', ctx)
    expect(result?.message).toBe(GITHUB_ERR_AUTH_FAILED)
  })

  it('surfaces the reset window in the rate-limit cause', () => {
    const result = classifyGitHubResponse(
      429,
      new Headers({ 'retry-after': '42' }),
      '',
      ctx,
    )
    expect(result?.cause).toContain('42 seconds')
  })

  it('returns undefined for a healthy 200', () => {
    expect(
      classifyGitHubResponse(200, new Headers(), '{}', ctx),
    ).toBeUndefined()
  })

  it('returns undefined for a 404 (handled by the caller)', () => {
    expect(
      classifyGitHubResponse(404, new Headers(), '{}', ctx),
    ).toBeUndefined()
  })

  it('returns undefined for a 403 permission denial with quota remaining', () => {
    const result = classifyGitHubResponse(
      403,
      new Headers({ 'x-ratelimit-remaining': '4999' }),
      '{"message":"Must have admin rights to Repository."}',
      ctx,
    )
    expect(result).toBeUndefined()
  })
})

describe('getRateLimitWaitSeconds', () => {
  it('prefers retry-after (seconds)', () => {
    expect(getRateLimitWaitSeconds(new Headers({ 'retry-after': '30' }))).toBe(
      30,
    )
  })

  it('falls back to x-ratelimit-reset (epoch seconds)', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 25
    const seconds = getRateLimitWaitSeconds(
      new Headers({ 'x-ratelimit-reset': String(resetEpoch) }),
    )
    expect(seconds).toBeGreaterThan(20)
    expect(seconds).toBeLessThanOrEqual(25)
  })

  it('returns undefined when neither header is present', () => {
    expect(getRateLimitWaitSeconds(new Headers())).toBeUndefined()
  })
})

describe('isGitHubBlockingError', () => {
  it('is true for rate limit / auth / abuse', () => {
    expect(isGitHubBlockingError(GITHUB_ERR_RATE_LIMIT)).toBe(true)
    expect(isGitHubBlockingError(GITHUB_ERR_AUTH_FAILED)).toBe(true)
    expect(isGitHubBlockingError(GITHUB_ERR_ABUSE_DETECTION)).toBe(true)
  })

  it('is false for a benign no-manifest result', () => {
    expect(isGitHubBlockingError('No manifest files found')).toBe(false)
  })
})

describe('githubApiRequest', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the response and body text on success', async () => {
    const fake = fakeFetch([{ status: 200, body: '{"ok":true}' }])
    const result = await githubApiRequest(
      'https://api.github.com/x',
      {},
      'x',
      fake.fetchImpl,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.bodyText).toBe('{"ok":true}')
      expect(result.data.response.status).toBe(200)
    }
    expect(fake.calls()).toBe(1)
  })

  it('surfaces a long-window rate limit immediately without retrying', async () => {
    // No retry-after / reset header => unknown window => surface now.
    const fake = fakeFetch([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        body: '{"message":"API rate limit exceeded"}',
      },
    ])
    const result = await githubApiRequest(
      'https://api.github.com/x',
      {},
      'x',
      fake.fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe(GITHUB_ERR_RATE_LIMIT)
    expect(fake.calls()).toBe(1)
  })

  it('never retries an auth failure', async () => {
    const fake = fakeFetch([{ status: 401 }])
    const result = await githubApiRequest(
      'https://api.github.com/x',
      {},
      'x',
      fake.fetchImpl,
    )
    expect(result.ok ? '' : result.message).toBe(GITHUB_ERR_AUTH_FAILED)
    expect(fake.calls()).toBe(1)
  })

  it('waits and retries once on a short rate-limit window, then succeeds', async () => {
    vi.useFakeTimers()
    const fake = fakeFetch([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '1' },
        body: '{"message":"API rate limit exceeded"}',
      },
      { status: 200, body: '{"recovered":true}' },
    ])
    const promise = githubApiRequest(
      'https://api.github.com/x',
      {},
      'x',
      fake.fetchImpl,
    )
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.bodyText).toBe('{"recovered":true}')
    }
    expect(fake.calls()).toBe(2)
  })

  it('retries transient 5xx with bounded backoff, then surfaces a server error', async () => {
    vi.useFakeTimers()
    const fake = fakeFetch([{ status: 503, body: 'unavailable' }])
    const promise = githubApiRequest(
      'https://api.github.com/x',
      {},
      'x',
      fake.fetchImpl,
    )
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toBe('GitHub server error')
    // Initial attempt + 2 retries = 3 total.
    expect(fake.calls()).toBe(3)
  })
})
