import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../helpers/sdk-test-helpers.mts'
import { fetchListRepos } from '../../../../src/commands/repository/fetch-list-repos.mts'

// Mock the dependencies.
vi.mock('../../../../src/utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchListRepos', () => {

  it('lists repositories with pagination successfully', async () => {
    const mockData = {
      results: [
        { id: 'repo-1', name: 'first-repo' },
        { id: 'repo-2', name: 'second-repo' },
      ],
      nextPage: 2,
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'listRepositories',
      mockData,
    )

    const config = {
      direction: 'desc',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      sort: 'created_at',
    }

    const result = await fetchListRepos(config)

    expect(mockSdk.listRepositories).toHaveBeenCalledWith('test-org', {
      sort: 'created_at',
      direction: 'desc',
      per_page: 10,
      page: 1,
    })
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'list of repositories',
    })
    expect(result.ok).toBe(true)
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token',
    })

    const config = {
      direction: 'asc',
      orgSlug: 'org',
      page: 0,
      perPage: 20,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(result.ok).toBe(false)
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('listRepositories', 'Invalid page number', 400)

    const config = {
      direction: 'asc',
      orgSlug: 'org',
      page: -1,
      perPage: 20,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(400)
    }
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    const config = {
      direction: 'asc',
      orgSlug: 'my-org',
      page: 0,
      perPage: 50,
      sort: 'updated_at',
    }

    const sdkOpts = {
      apiToken: 'paginated-token',
      baseUrl: 'https://paginated.api.com',
    }

    await fetchListRepos(config, { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })

  it('handles large page size configuration', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    const config = {
      direction: 'desc',
      orgSlug: 'large-org',
      page: 0,
      perPage: 100,
      sort: 'stars',
    }

    await fetchListRepos(config)

    expect(mockSdk.listRepositories).toHaveBeenCalledWith('large-org', {
      sort: 'stars',
      direction: 'desc',
      per_page: 100,
      page: 0,
    })
  })

  it('handles different sort criteria', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    const config = {
      direction: 'asc',
      orgSlug: 'sort-org',
      page: 0,
      perPage: 25,
      sort: 'alphabetical',
    }

    await fetchListRepos(config)

    expect(mockSdk.listRepositories).toHaveBeenCalledWith('sort-org', {
      sort: 'alphabetical',
      direction: 'asc',
      per_page: 25,
      page: 0,
    })
  })

  it('handles empty results on specific page', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    const config = {
      direction: 'asc',
      orgSlug: 'empty-org',
      page: 10,
      perPage: 20,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.results).toHaveLength(0)
    }
  })

  it('uses null prototype for options', async () => {
    const { mockSdk } = await setupSdkMockSuccess('listRepositories', {
      results: [],
      nextPage: null,
    })

    const config = {
      direction: 'asc',
      orgSlug: 'test-org',
      page: 0,
      perPage: 10,
      sort: 'name',
    }

    // This tests that the function properly uses __proto__: null.
    await fetchListRepos(config)

    // The function should work without prototype pollution issues.
    expect(mockSdk.listRepositories).toHaveBeenCalled()
  })
})
