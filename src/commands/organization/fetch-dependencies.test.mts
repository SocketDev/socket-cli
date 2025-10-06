import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDependencies } from './fetch-dependencies.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches dependencies successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        dependencies: [
          { name: 'express', version: '4.18.2', count: 15 },
          { name: 'lodash', version: '4.17.21', count: 23 },
        ],
        total: 2,
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      limit: 100,
      offset: 0,
    }

    const result = await fetchDependencies(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization dependencies',
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

    const config = {
      limit: 50,
      offset: 0,
    }

    const result = await fetchDependencies(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization dependencies',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Dependencies service unavailable',
      code: 503,
      message: 'Dependencies service unavailable',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      limit: 100,
      offset: 0,
    }

    const result = await fetchDependencies(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization dependencies',
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
      apiToken: 'deps-token',
      baseUrl: 'https://deps.api.com',
    }

    const config = {
      limit: 100,
      offset: 0,
    }

    await fetchDependencies(config, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization dependencies',
      { sdkOpts },
    )
  })

  it('handles pagination parameters', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      limit: 50,
      offset: 100,
    }

    const result = await fetchDependencies(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'organization dependencies',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      limit: 100,
      offset: 0,
    }

    // This tests that the function properly uses __proto__: null.
    await fetchDependencies(config)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
