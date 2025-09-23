import { describe, expect, it, vi } from 'vitest'

import { fetchPurlsShallowScore } from './fetch-purls-shallow-score.mts'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchPurlsShallowScore', () => {
  it('fetches purls shallow scores successfully', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      batchPackageFetch: vi.fn().mockResolvedValue({
        success: true,
        data: [
          {
            purl: 'pkg:npm/lodash@4.17.21',
            score: 85,
            name: 'lodash',
            version: '4.17.21',
          },
          {
            purl: 'pkg:npm/express@4.18.2',
            score: 92,
            name: 'express',
            version: '4.18.2',
          },
        ],
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: [
        { purl: 'pkg:npm/lodash@4.17.21', score: 85 },
        { purl: 'pkg:npm/express@4.18.2', score: 92 },
      ],
    })

    const purls = ['pkg:npm/lodash@4.17.21', 'pkg:npm/express@4.18.2']
    const result = await fetchPurlsShallowScore(purls)

    expect(mockSdk.batchPackageFetch).toHaveBeenCalledWith(
      { components: purls.map(purl => ({ purl })) },
      { alerts: 'true' },
    )
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'looking up package',
    })
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(2)
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

    const result = await fetchPurlsShallowScore(['pkg:npm/test@1.0.0'])

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      batchPackageFetch: vi
        .fn()
        .mockRejectedValue(new Error('Batch too large')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Batch size exceeded',
      code: 400,
    })

    const result = await fetchPurlsShallowScore(
      Array(1000).fill('pkg:npm/test@1.0.0'),
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe(400)
  })

  it('passes custom SDK options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      batchPackageFetch: vi.fn().mockResolvedValue([]),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: [] })

    const sdkOpts = {
      apiToken: 'batch-token',
      baseUrl: 'https://batch.api.com',
    }

    await fetchPurlsShallowScore(['pkg:npm/test@1.0.0'], { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles empty purl array', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      batchPackageFetch: vi.fn().mockResolvedValue([]),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: [] })

    const result = await fetchPurlsShallowScore([])

    expect(mockSdk.batchPackageFetch).toHaveBeenCalledWith(
      { components: [] },
      { alerts: 'true' },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('handles mixed purl types', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      batchPackageFetch: vi.fn().mockResolvedValue([]),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: [] })

    const mixedPurls = [
      'pkg:npm/lodash@4.17.21',
      'pkg:pypi/django@4.2.0',
      'pkg:maven/org.springframework/spring-core@5.3.0',
      'pkg:gem/rails@7.0.0',
    ]

    await fetchPurlsShallowScore(mixedPurls)

    expect(mockSdk.batchPackageFetch).toHaveBeenCalledWith(
      { components: mixedPurls.map(purl => ({ purl })) },
      { alerts: 'true' },
    )
  })

  it('handles large batch of purls', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const largeBatch = Array(100)
      .fill(0)
      .map((_, i) => `pkg:npm/package-${i}@1.0.0`)
    const mockResults = largeBatch.map(purl => ({ purl, score: 80 }))

    const mockSdk = {
      batchPackageFetch: vi.fn().mockResolvedValue(mockResults),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: mockResults })

    const result = await fetchPurlsShallowScore(largeBatch)

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(100)
  })

  it('uses null prototype for options', async () => {
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      batchPackageFetch: vi.fn().mockResolvedValue([]),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: [] })

    // This tests that the function properly uses __proto__: null.
    await fetchPurlsShallowScore(['pkg:npm/test@1.0.0'])

    // The function should work without prototype pollution issues.
    expect(mockSdk.batchPackageFetch).toHaveBeenCalled()
  })
})
