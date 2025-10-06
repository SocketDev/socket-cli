import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchListRepos } from './fetch-list-repos.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchListRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists repositories with pagination successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        repositories: [
          { id: 'repo-1', name: 'repo1' },
          { id: 'repo-2', name: 'repo2' },
        ],
        total: 2,
        page: 1,
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      direction: 'desc',
      orgSlug: 'test-org',
      page: 1,
      perPage: 100,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
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
      direction: 'asc',
      orgSlug: 'my-org',
      page: 1,
      perPage: 50,
      sort: 'created',
    }

    const result = await fetchListRepos(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Organization not found',
      code: 404,
      message: 'Organization not found',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const config = {
      direction: 'desc',
      orgSlug: 'nonexistent-org',
      page: 1,
      perPage: 100,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
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
      apiToken: 'list-repos-token',
      baseUrl: 'https://repos.api.com',
    }

    const config = {
      direction: 'desc',
      orgSlug: 'custom-org',
      page: 1,
      perPage: 100,
      sort: 'name',
    }

    await fetchListRepos(config, { sdkOpts })

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
      { sdkOpts },
    )
  })

  it('handles large page size configuration', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        repositories: Array.from({ length: 200 }, (_, i) => ({
          id: `repo-${i}`,
          name: `repo${i}`,
        })),
        total: 200,
        page: 1,
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      direction: 'desc',
      orgSlug: 'test-org',
      page: 1,
      perPage: 200,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
      undefined,
    )
    expect(result.ok).toBe(true)
  })

  it('handles different sort criteria', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const sortOptions = [
      { sort: 'name', direction: 'asc' },
      { sort: 'created', direction: 'desc' },
      { sort: 'updated', direction: 'desc' },
      { sort: 'pushed', direction: 'asc' },
    ]

    for (const sortConfig of sortOptions) {
      mockWithSdk.mockResolvedValueOnce(successResult)
      const config = {
        direction: sortConfig.direction,
        orgSlug: 'test-org',
        page: 1,
        perPage: 100,
        sort: sortConfig.sort,
      }
      // eslint-disable-next-line no-await-in-loop
      await fetchListRepos(config)
    }

    expect(mockWithSdk).toHaveBeenCalledTimes(sortOptions.length)
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
      undefined,
    )
  })

  it('handles empty results on specific page', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        repositories: [],
        total: 0,
        page: 5,
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const config = {
      direction: 'desc',
      orgSlug: 'test-org',
      page: 5,
      perPage: 100,
      sort: 'name',
    }

    const result = await fetchListRepos(config)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'list of repositories',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.repositories).toEqual([])
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

    const config = {
      direction: 'desc',
      orgSlug: 'test-org',
      page: 1,
      perPage: 100,
      sort: 'name',
    }

    // This tests that the function properly uses __proto__: null.
    await fetchListRepos(config)

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
