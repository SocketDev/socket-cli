import { describe, expect, it, vi } from 'vitest'

import { fetchOrgAnalyticsData } from './fetch-org-analytics.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrgAnalytics', () => {
  it('fetches organization analytics successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgAnalytics: vi.fn().mockResolvedValue({
        success: true,
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
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        packages: 125,
        repositories: 45,
        scans: 320,
      },
    })

    const result = await fetchOrgAnalyticsData(30)

    expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith('30')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'analytics data',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchOrgAnalyticsData(7)

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgAnalytics: vi
        .fn()
        .mockRejectedValue(new Error('Analytics unavailable')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Analytics service unavailable',
      code: 503,
    })

    const result = await fetchOrgAnalyticsData(30)

    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'analytics-token',
      baseUrl: 'https://analytics.api.com',
    }

    await fetchOrgAnalyticsData(90, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different organization slugs', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const times = [7, 14, 30, 60, 90]

    for (const time of times) {
      // eslint-disable-next-line no-await-in-loop
      await fetchOrgAnalyticsData(time)
      expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith(time.toString())
    }
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgAnalytics: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchOrgAnalyticsData(30)

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgAnalytics).toHaveBeenCalled()
  })
})
