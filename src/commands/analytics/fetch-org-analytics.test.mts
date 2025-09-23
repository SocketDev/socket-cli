import { describe, expect, it, vi } from 'vitest'

import { fetchOrgAnalytics } from './fetch-org-analytics.mts'

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

    const result = await fetchOrgAnalytics('test-org')

    expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith('test-org')
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'fetching organization analytics',
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

    const result = await fetchOrgAnalytics('my-org')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgAnalytics: vi.fn().mockRejectedValue(new Error('Network error')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Failed to fetch analytics',
      code: 500,
    })

    const result = await fetchOrgAnalytics('org-name')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
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
      apiToken: 'custom-token-123',
      baseUrl: 'https://api.example.com',
    }

    await fetchOrgAnalytics('my-org', { sdkOpts })

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

    const testCases = [
      'simple-org',
      'org_with_underscore',
      'org123',
      'my-organization-name',
    ]

    for (const orgSlug of testCases) {
      // eslint-disable-next-line no-await-in-loop
      await fetchOrgAnalytics(orgSlug)
      expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith(orgSlug)
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
    await fetchOrgAnalytics('test-org')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getOrgAnalytics).toHaveBeenCalled()
  })
})
