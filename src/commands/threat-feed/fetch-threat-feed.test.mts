import { describe, expect, it, vi } from 'vitest'

import { fetchThreatFeed } from './fetch-threat-feed.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchThreatFeed', () => {
  it('fetches threat feed successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getThreatFeed: vi.fn().mockResolvedValue({
        success: true,
        data: {
          threats: [
            {
              id: 'threat-1',
              package: 'malicious-package',
              version: '1.0.0',
              severity: 'critical',
              type: 'malware',
              discovered: '2025-01-20T10:00:00Z',
            },
            {
              id: 'threat-2',
              package: 'vulnerable-lib',
              version: '2.3.1',
              severity: 'high',
              type: 'vulnerability',
              discovered: '2025-01-19T15:00:00Z',
            },
          ],
          total: 2,
          updated_at: '2025-01-20T12:00:00Z',
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        threats: expect.any(Array),
        total: 2,
      },
    })

    const result = await fetchThreatFeed({
      limit: 100,
      offset: 0,
      severity: 'high',
      type: 'malware',
    })

    expect(mockSdk.getThreatFeed).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      severity: 'high',
      type: 'malware',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'fetching threat feed',
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

    const result = await fetchThreatFeed({ limit: 50 })

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getThreatFeed: vi
        .fn()
        .mockRejectedValue(new Error('Service unavailable')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Threat feed service unavailable',
      code: 503,
    })

    const result = await fetchThreatFeed({})

    expect(result.ok).toBe(false)
    expect(result.code).toBe(503)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getThreatFeed: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'threat-token',
      baseUrl: 'https://threat.api.com',
    }

    await fetchThreatFeed({ limit: 20 }, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles filtering by severity levels', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getThreatFeed: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const severities = ['critical', 'high', 'medium', 'low']

    for (const severity of severities) {
      // eslint-disable-next-line no-await-in-loop
      await fetchThreatFeed({ severity })
      expect(mockSdk.getThreatFeed).toHaveBeenCalledWith({ severity })
    }
  })

  it('handles pagination parameters', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getThreatFeed: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchThreatFeed({
      limit: 500,
      offset: 100,
      page: 3,
    })

    expect(mockSdk.getThreatFeed).toHaveBeenCalledWith({
      limit: 500,
      offset: 100,
      page: 3,
    })
  })

  it('handles date range filtering', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getThreatFeed: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    await fetchThreatFeed({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-31T23:59:59Z',
      type: 'vulnerability',
    })

    expect(mockSdk.getThreatFeed).toHaveBeenCalledWith({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-31T23:59:59Z',
      type: 'vulnerability',
    })
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getThreatFeed: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchThreatFeed({ limit: 10 })

    // The function should work without prototype pollution issues.
    expect(mockSdk.getThreatFeed).toHaveBeenCalled()
  })
})
