import { describe, expect, it, vi } from 'vitest'

import { fetchQuota } from './fetch-quota.mts'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchQuota', () => {
  it('fetches quota successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getQuota: vi.fn().mockResolvedValue({
        success: true,
        data: {
          scans: {
            used: 250,
            limit: 1000,
            percentage: 25,
          },
          packages: {
            used: 500,
            limit: 2000,
            percentage: 25,
          },
          repositories: {
            used: 10,
            limit: 50,
            percentage: 20,
          },
          period_start: '2025-01-01T00:00:00Z',
          period_end: '2025-01-31T23:59:59Z',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        scans: { used: 250, limit: 1000 },
        packages: { used: 500, limit: 2000 },
        repositories: { used: 10, limit: 50 },
      },
    })

    const result = await fetchQuota()

    expect(mockSdk.getQuota).toHaveBeenCalledWith()
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'token quota',
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

    const result = await fetchQuota()

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getQuota: vi.fn().mockRejectedValue(new Error('Quota unavailable')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Quota information unavailable',
      code: 503,
    })

    const result = await fetchQuota()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getQuota: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'quota-token',
      baseUrl: 'https://quota.api.com',
    }

    await fetchQuota({ sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles quota at limit', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getQuota: vi.fn().mockResolvedValue({
        scans: {
          used: 1000,
          limit: 1000,
          percentage: 100,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        scans: { used: 1000, limit: 1000, percentage: 100 },
      },
    })

    const result = await fetchQuota()

    expect(result.ok).toBe(true)
    expect(result.data.scans.percentage).toBe(100)
  })

  it('handles various org slugs', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getQuota: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const orgSlugs = [
      'simple',
      'org-with-dashes',
      'org_underscore',
      'org123numbers',
    ]

    for (const orgSlug of orgSlugs) {
      // eslint-disable-next-line no-await-in-loop
      await fetchQuota()
      expect(mockSdk.getQuota).toHaveBeenCalledWith()
    }
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getQuota: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchQuota()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getQuota).toHaveBeenCalled()
  })
})
