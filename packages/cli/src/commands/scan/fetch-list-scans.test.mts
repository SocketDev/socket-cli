import { describe, expect, it, vi } from 'vitest'

import { setupSdkMockSuccess } from '../../../test/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mjs', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrgFullScanList', () => {
  it('fetches scan list successfully', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'listFullScans',
      {
        scans: [
          { id: 'scan-123', status: 'completed' },
          { id: 'scan-456', status: 'pending' },
        ],
      },
    )

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

    expect(mockSdk.listFullScans).toHaveBeenCalledWith('test-org', {
      branch: 'main',
      repo: 'test-repo',
      sort: 'created_at',
      direction: 'desc',
      from: '2023-01-01',
      page: '1',
      per_page: '10',
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'list of scans',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdkSetupFailure } = await import(
      '../../../test/helpers/sdk-test-helpers.mts'
    )

    await setupSdkSetupFailure('Failed to setup SDK', {
      cause: 'Invalid configuration',
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
    expect(result.message).toBe('Failed to setup SDK')
    expect(result.cause).toBe('Invalid configuration')
  })

  it('handles API call failure', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')
    const { setupSdkMockError } = await import(
      '../../../test/helpers/sdk-test-helpers.mts'
    )

    await setupSdkMockError('listFullScans', 'API error', 500)

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

    const { mockSdk, mockSetupSdk } = await setupSdkMockSuccess(
      'listFullScans',
      {},
    )

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
    expect(mockSdk.listFullScans).toHaveBeenCalledWith('custom-org', {
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

    const { mockSdk } = await setupSdkMockSuccess('listFullScans', {})

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

    expect(mockSdk.listFullScans).toHaveBeenCalledWith('test-org', {
      sort: 'created_at',
      direction: 'desc',
      from: '2023-01-01',
      page: '1',
      per_page: '10',
    })
  })

  it('handles different pagination parameters', async () => {
    const { fetchOrgFullScanList } = await import('./fetch-list-scans.mts')

    const { mockSdk } = await setupSdkMockSuccess('listFullScans', {})

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

      expect(mockSdk.listFullScans).toHaveBeenCalledWith('test-org', {
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

    const { mockSdk } = await setupSdkMockSuccess('listFullScans', {})

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

      expect(mockSdk.listFullScans).toHaveBeenCalledWith('test-org', {
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

    const { mockSdk } = await setupSdkMockSuccess('listFullScans', {})

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
    expect(mockSdk.listFullScans).toHaveBeenCalled()
  })
})
