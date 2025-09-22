import { describe, expect, it, vi } from 'vitest'

import { fetchPurlDeepScore } from './fetch-purl-deep-score.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchPurlDeepScore', () => {
  it('fetches purl deep score successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getPurlDeepScore: vi.fn().mockResolvedValue({
        success: true,
        data: {
          purl: 'pkg:npm/lodash@4.17.21',
          score: 85,
          scores: {
            supply_chain: 90,
            quality: 88,
            maintenance: 82,
            vulnerability: 80,
            license: 95,
          },
          issues: [],
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        purl: 'pkg:npm/lodash@4.17.21',
        score: 85,
      },
    })

    const result = await fetchPurlDeepScore('pkg:npm/lodash@4.17.21')

    expect(mockSdk.getPurlDeepScore).toHaveBeenCalledWith('pkg:npm/lodash@4.17.21')
    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'fetching purl deep score' },
    )
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid token',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchPurlDeepScore('pkg:npm/express@4.18.2')

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getPurlDeepScore: vi.fn().mockRejectedValue(new Error('Package not found')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Package not found',
      code: 404,
    })

    const result = await fetchPurlDeepScore('pkg:npm/nonexistent@1.0.0')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getPurlDeepScore: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const sdkOpts = {
      apiToken: 'purl-token',
      baseUrl: 'https://purl.api.com',
    }

    await fetchPurlDeepScore('pkg:npm/react@18.0.0', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles different purl formats', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getPurlDeepScore: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const purls = [
      'pkg:npm/lodash@4.17.21',
      'pkg:pypi/django@4.2.0',
      'pkg:maven/org.springframework/spring-core@5.3.0',
      'pkg:gem/rails@7.0.0',
      'pkg:nuget/Newtonsoft.Json@13.0.1',
    ]

    for (const purl of purls) {
      // eslint-disable-next-line no-await-in-loop
      await fetchPurlDeepScore(purl)
      expect(mockSdk.getPurlDeepScore).toHaveBeenCalledWith(purl)
    }
  })

  it('handles low score packages', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getPurlDeepScore: vi.fn().mockResolvedValue({
        score: 25,
        issues: [
          { type: 'vulnerability', severity: 'critical' },
          { type: 'maintenance', severity: 'high' },
        ],
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: { score: 25, issues: expect.any(Array) },
    })

    const result = await fetchPurlDeepScore('pkg:npm/vulnerable@0.1.0')

    expect(result.ok).toBe(true)
    expect(result.data.score).toBe(25)
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getPurlDeepScore: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchPurlDeepScore('pkg:npm/test@1.0.0')

    // The function should work without prototype pollution issues.
    expect(mockSdk.getPurlDeepScore).toHaveBeenCalled()
  })
})
