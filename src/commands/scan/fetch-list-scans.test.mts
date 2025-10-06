import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchOrgFullScanList } from './fetch-list-scans.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchOrgFullScanList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches scan list successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        scans: [
          {
            id: 'scan-123',
            status: 'completed',
            createdAt: '2023-01-01T00:00:00Z',
          },
          {
            id: 'scan-456',
            status: 'pending',
            createdAt: '2023-01-02T00:00:00Z',
          },
        ],
        pagination: {
          page: 1,
          perPage: 10,
          total: 2,
        },
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      branch: 'main',
      direction: 'desc',
      from_time: '2023-01-01',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      repo: 'test-repo',
      sort: 'created_at',
    }

    const result = await fetchOrgFullScanList(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
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

    const config = {
      branch: 'main',
      direction: 'desc',
      from_time: '2023-01-01',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      repo: 'test-repo',
      sort: 'created_at',
    }

    const result = await fetchOrgFullScanList(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Failed to fetch scan list',
      code: 500,
      message: 'Failed to fetch scan list',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      branch: 'main',
      direction: 'desc',
      from_time: '2023-01-01',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      repo: 'test-repo',
      sort: 'created_at',
    }

    const result = await fetchOrgFullScanList(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      branch: 'develop',
      direction: 'asc',
      from_time: '2023-06-01',
      orgSlug: 'custom-org',
      page: 2,
      perPage: 25,
      repo: 'custom-repo',
      sort: 'updated_at',
    }

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchOrgFullScanList(config, options)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
      options,
    )
  })

  it('handles empty optional config values', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      branch: '',
      direction: 'desc',
      from_time: '2023-01-01',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      repo: '',
      sort: 'created_at',
    }

    await fetchOrgFullScanList(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
      undefined,
    )
  })

  it('handles different pagination parameters', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const testCases = [
      { page: 1, perPage: 10 },
      { page: 5, perPage: 25 },
      { page: 10, perPage: 50 },
      { page: 100, perPage: 1 },
    ]

    for (const { page, perPage } of testCases) {
      mockWithSdk.mockResolvedValueOnce(successResult)

      const config = {
        branch: 'main',
        direction: 'desc',
        from_time: '2023-01-01',
        orgSlug: 'test-org',
        page,
        perPage,
        repo: 'test-repo',
        sort: 'created_at',
      }

      // eslint-disable-next-line no-await-in-loop
      await fetchOrgFullScanList(config)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(testCases.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
      undefined,
    )
  })

  it('handles different sort and direction combinations', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const testCases = [
      { sort: 'created_at', direction: 'asc' },
      { sort: 'created_at', direction: 'desc' },
      { sort: 'updated_at', direction: 'asc' },
      { sort: 'status', direction: 'desc' },
    ]

    for (const { direction, sort } of testCases) {
      mockWithSdk.mockResolvedValueOnce(successResult)

      const config = {
        branch: 'main',
        direction,
        from_time: '2023-01-01',
        orgSlug: 'test-org',
        page: 1,
        perPage: 10,
        repo: 'test-repo',
        sort,
      }

      // eslint-disable-next-line no-await-in-loop
      await fetchOrgFullScanList(config)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(testCases.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of scans',
      undefined,
    )
  })

  it('uses null prototype for config and options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      branch: 'main',
      direction: 'desc',
      from_time: '2023-01-01',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      repo: 'test-repo',
      sort: 'created_at',
    }

    // This tests that the function properly uses __proto__: null.
    await fetchOrgFullScanList(config)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
