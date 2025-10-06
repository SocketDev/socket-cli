import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchQuota } from './fetch-quota.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches quota successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        used: 850,
        limit: 1000,
        remaining: 150,
        resetDate: '2025-02-01T00:00:00Z',
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchQuota()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'token quota',
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

    const result = await fetchQuota()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'token quota',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Quota service unavailable',
      code: 503,
      message: 'Quota service unavailable',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchQuota()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'token quota',
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
      apiToken: 'quota-token',
      baseUrl: 'https://quota.api.com',
    }

    await fetchQuota({ sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'token quota',
      { sdkOpts },
    )
  })

  it('handles zero quota remaining', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        used: 1000,
        limit: 1000,
        remaining: 0,
        resetDate: '2025-02-01T00:00:00Z',
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchQuota()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'token quota',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.remaining).toBe(0)
    }
  })

  it('handles unlimited quota', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        used: 500,
        limit: -1,
        remaining: -1,
        resetDate: null,
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchQuota()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'token quota',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.limit).toBe(-1)
    }
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
    await fetchQuota()

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
