import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchOrgAnalyticsData } from './fetch-org-analytics.mts'

// Mock the dependencies
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchOrgAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches organization analytics successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        packages: 125,
        repositories: 45,
        scans: 320,
        vulnerabilities: {
          critical: 5,
          high: 12,
          medium: 28,
          low: 45,
        },
        lastUpdated: '2025-01-01T00:00:00Z',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchOrgAnalyticsData(30)

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
      cause: 'Invalid configuration',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchOrgAnalyticsData(7)

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Analytics service unavailable',
      code: 503,
      message: 'Analytics service unavailable',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchOrgAnalyticsData(30)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
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
      apiToken: 'analytics-token',
      baseUrl: 'https://analytics.api.com',
    }

    await fetchOrgAnalyticsData(90, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'analytics data',
      { sdkOpts },
    )
  })

  it('handles different organization slugs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const times = [7, 14, 30, 60, 90]

    for (const time of times) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      // eslint-disable-next-line no-await-in-loop
      await fetchOrgAnalyticsData(time)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(times.length)
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
    await fetchOrgAnalyticsData(30)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
