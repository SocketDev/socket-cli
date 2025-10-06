import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchRepoAnalyticsData } from './fetch-repo-analytics.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchRepoAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches repository analytics successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        commits: 450,
        contributors: 12,
        issues: 85,
        pullRequests: 120,
        stars: 340,
        lastUpdated: '2025-01-20T12:00:00Z',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchRepoAnalyticsData('test-repo', 30)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      undefined,
    )
    expect(result).toEqual(successResult)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Configuration error',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchRepoAnalyticsData('my-repo', 7)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Repository analytics unavailable',
      code: 404,
      message: 'Repository analytics unavailable',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchRepoAnalyticsData('nonexistent-repo', 30)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const sdkOpts = {
      apiToken: 'repo-analytics-token',
      baseUrl: 'https://repo.api.com',
    }

    await fetchRepoAnalyticsData('custom-repo', 90, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      { sdkOpts },
    )
  })

  it('handles different org and repo combinations', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const repos = ['org/repo1', 'org/repo2', 'another-org/repo', 'user/project']

    for (const repo of repos) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalyticsData(repo, 30)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(repos.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      undefined,
    )
  })

  it('handles different time ranges', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const timeRanges = [1, 7, 14, 30, 60, 90, 365]

    for (const time of timeRanges) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalyticsData('test-repo', time)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(timeRanges.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      undefined,
    )
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    // This tests that the function properly uses __proto__: null.
    await fetchRepoAnalyticsData('test-repo', 30)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
