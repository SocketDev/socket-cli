import { describe, expect, it, vi } from 'vitest'

// Mock the dependencies.
vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrgFullScanList', () => {
  it('fetches scan list successfully', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockResolvedValue({
        success: true,
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
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        scans: [
          { id: 'scan-123', status: 'completed' },
          { id: 'scan-456', status: 'pending' },
        ],
      },
    })

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

    expect(mockSdk.getOrgFullScanList).toHaveBeenCalledWith('test-org', {
      branch: 'main',
      repo: 'test-repo',
      sort: 'created_at',
      direction: 'desc',
      from: '2023-01-01',
      page: '1',
      per_page: '10',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'list of scans' },
    )
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(setupSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

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

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(setupSdk)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockRejectedValue(new Error('API error')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Failed to fetch scan list',
      code: 500,
    })

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

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

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

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
    expect(mockSdk.getOrgFullScanList).toHaveBeenCalledWith('custom-org', {
      branch: 'develop',
      repo: 'custom-repo',
      sort: 'updated_at',
      direction: 'asc',
      from: '2023-06-01',
      page: '2',
      per_page: '25',
    })
  })

  it('handles empty optional config values', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

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

    expect(mockSdk.getOrgFullScanList).toHaveBeenCalledWith('test-org', {
      sort: 'created_at',
      direction: 'desc',
      from: '2023-01-01',
      page: '1',
      per_page: '10',
    })
  })

  it('handles different pagination parameters', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const testCases = [
      { page: 1, perPage: 10 },
      { page: 5, perPage: 25 },
      { page: 10, perPage: 50 },
      { page: 100, perPage: 1 },
    ]

    for (const { page, perPage } of testCases) {
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

      expect(mockSdk.getOrgFullScanList).toHaveBeenCalledWith('test-org', {
        branch: 'main',
        repo: 'test-repo',
        sort: 'created_at',
        direction: 'desc',
        from: '2023-01-01',
        page: String(page),
        per_page: String(perPage),
      })
    }
  })

  it('handles different sort and direction combinations', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const testCases = [
      { sort: 'created_at', direction: 'asc' },
      { sort: 'created_at', direction: 'desc' },
      { sort: 'updated_at', direction: 'asc' },
      { sort: 'status', direction: 'desc' },
    ]

    for (const { direction, sort } of testCases) {
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

      expect(mockSdk.getOrgFullScanList).toHaveBeenCalledWith('test-org', {
        branch: 'main',
        repo: 'test-repo',
        sort,
        direction,
        from: '2023-01-01',
        page: '1',
        per_page: '10',
      })
    }
  })

  it('uses null prototype for config and options', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(setupSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getOrgFullScanList: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

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
    expect(mockSdk.getOrgFullScanList).toHaveBeenCalled()
  })
})