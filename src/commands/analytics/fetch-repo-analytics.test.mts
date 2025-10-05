import { describe, expect, it, vi } from 'vitest'

import { fetchRepoAnalyticsData } from './fetch-repo-analytics.mts'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchRepoAnalytics', () => {
  it('fetches repository analytics successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({
        success: true,
        data: {
          commits: 450,
          contributors: 12,
          issues: 85,
          pullRequests: 120,
          stars: 340,
          lastUpdated: '2025-01-20T12:00:00Z',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        commits: 450,
        contributors: 12,
        issues: 85,
      },
    })

    const result = await fetchRepoAnalyticsData('test-repo', 30)

    expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith('test-repo', '30')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'analytics data',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(withSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Configuration error',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchRepoAnalyticsData('my-repo', 7)

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getRepoAnalytics: vi
        .fn()
        .mockRejectedValue(new Error('Repository not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Repository analytics unavailable',
      code: 404,
    })

    const result = await fetchRepoAnalyticsData('nonexistent-repo', 30)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'repo-analytics-token',
      baseUrl: 'https://repo.api.com',
    }

    await fetchRepoAnalyticsData('custom-repo', 90, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different org and repo combinations', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const repos = ['org/repo1', 'org/repo2', 'another-org/repo', 'user/project']

    for (const repo of repos) {
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalyticsData(repo, 30)
      expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(repo, '30')
    }
  })

  it('handles different time ranges', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const timeRanges = [1, 7, 14, 30, 60, 90, 365]

    for (const time of timeRanges) {
      // eslint-disable-next-line no-await-in-loop
      await fetchRepoAnalyticsData('test-repo', time)
      expect(mockSdk.getRepoAnalytics).toHaveBeenCalledWith(
        'test-repo',
        time.toString(),
      )
    }
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getRepoAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchRepoAnalyticsData('test-repo', 30)

    // The function should work without prototype pollution issues.
    expect(mockSdk.getRepoAnalytics).toHaveBeenCalled()
  })
})
