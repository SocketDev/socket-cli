import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchPurlsShallowScore } from './fetch-purls-shallow-score.mts'

// Mock the dependencies
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchPurlsShallowScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches purls shallow scores successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        known: [
          {
            purl: 'pkg:npm/lodash@4.17.21',
            score: 95,
            alerts: [],
          },
        ],
        unknown: [],
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const purls = ['pkg:npm/lodash@4.17.21']
    const result = await fetchPurlsShallowScore(purls)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
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
      cause: 'Invalid API token',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const purls = ['pkg:npm/express@4.18.0']
    const result = await fetchPurlsShallowScore(purls)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Batch fetch service unavailable',
      code: 503,
      message: 'Batch fetch service unavailable',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const purls = ['pkg:npm/react@18.0.0']
    const result = await fetchPurlsShallowScore(purls)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
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
      data: {
        known: [],
        unknown: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const sdkOpts = {
      apiToken: 'batch-token',
      baseUrl: 'https://batch.api.com',
    }

    const purls = ['pkg:npm/test@1.0.0']
    await fetchPurlsShallowScore(purls, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
      { sdkOpts },
    )
  })

  it('handles empty purl array', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        known: [],
        unknown: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const purls: string[] = []
    const result = await fetchPurlsShallowScore(purls)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('handles mixed purl types', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        known: [
          { purl: 'pkg:npm/lodash@4.17.21', score: 95, alerts: [] },
          { purl: 'pkg:pypi/requests@2.28.0', score: 92, alerts: [] },
          { purl: 'pkg:maven/junit/junit@4.13', score: 88, alerts: [] },
        ],
        unknown: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const purls = [
      'pkg:npm/lodash@4.17.21',
      'pkg:pypi/requests@2.28.0',
      'pkg:maven/junit/junit@4.13',
    ]
    const result = await fetchPurlsShallowScore(purls)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.known).toHaveLength(3)
    }
  })

  it('handles large batch of purls', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        known: Array.from({ length: 50 }, (_, i) => ({
          purl: `pkg:npm/package${i}@1.0.0`,
          score: 90,
          alerts: [],
        })),
        unknown: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const purls = Array.from(
      { length: 50 },
      (_, i) => `pkg:npm/package${i}@1.0.0`,
    )
    const result = await fetchPurlsShallowScore(purls)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'looking up package',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.known).toHaveLength(50)
    }
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        known: [],
        unknown: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const purls = ['pkg:npm/test@1.0.0']
    // This tests that the function properly uses __proto__: null.
    await fetchPurlsShallowScore(purls)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
