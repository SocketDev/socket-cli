import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleListRepos } from '../../../../../src/commands/repository/handle-list-repos.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/repository/fetch-list-all-repos.mts', () => ({
  fetchListAllRepos: vi.fn(),
}))
vi.mock('../../../../../src/commands/repository/fetch-list-repos.mts', () => ({
  fetchListRepos: vi.fn(),
}))
vi.mock('../../../../../src/commands/repository/output-list-repos.mts', () => ({
  outputListRepos: vi.fn(),
}))

describe('handleListRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches all repositories when all flag is true', async () => {
    const { fetchListAllRepos } = await import('../../src/fetch-list-all-repos.mts')
    const { outputListRepos } = await import('../../src/output-list-repos.mts')

    const mockData = {
      ok: true,
      data: [
        { id: '1', name: 'repo1' },
        { id: '2', name: 'repo2' },
        { id: '3', name: 'repo3' },
      ],
    }
    vi.mocked(fetchListAllRepos).mockResolvedValue(mockData)

    await handleListRepos({
      all: true,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
      sort: 'name',
    })

    expect(fetchListAllRepos).toHaveBeenCalledWith('test-org', {
      direction: 'asc',
      sort: 'name',
    })
    expect(outputListRepos).toHaveBeenCalledWith(
      mockData,
      'json',
      0,
      0,
      'name',
      Number.POSITIVE_INFINITY,
      'asc',
    )
  })

  it('fetches paginated repositories when all is false', async () => {
    const { fetchListRepos } = await import('../../src/fetch-list-repos.mts')
    const { outputListRepos } = await import('../../src/output-list-repos.mts')

    const mockData = {
      ok: true,
      data: {
        repos: [
          { id: '1', name: 'repo1' },
          { id: '2', name: 'repo2' },
        ],
        nextPage: 2,
      },
    }
    vi.mocked(fetchListRepos).mockResolvedValue(mockData)

    await handleListRepos({
      all: false,
      direction: 'desc',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: 1,
      perPage: 10,
      sort: 'updated',
    })

    expect(fetchListRepos).toHaveBeenCalledWith({
      direction: 'desc',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      sort: 'updated',
    })
    expect(outputListRepos).toHaveBeenCalledWith(
      mockData,
      'text',
      1,
      2,
      'updated',
      10,
      'desc',
    )
  })

  it('handles error response for paginated fetch', async () => {
    const { fetchListRepos } = await import('../../src/fetch-list-repos.mts')
    const { outputListRepos } = await import('../../src/output-list-repos.mts')

    const mockError = {
      ok: false,
      error: new Error('Failed to fetch repositories'),
    }
    vi.mocked(fetchListRepos).mockResolvedValue(mockError)

    await handleListRepos({
      all: false,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 20,
      sort: 'name',
    })

    expect(outputListRepos).toHaveBeenCalledWith(
      mockError,
      'json',
      0,
      0,
      '',
      0,
      'asc',
    )
  })

  it('handles null nextPage for last page', async () => {
    const { fetchListRepos } = await import('../../src/fetch-list-repos.mts')
    const { outputListRepos } = await import('../../src/output-list-repos.mts')

    const mockData = {
      ok: true,
      data: {
        repos: [{ id: '1', name: 'repo1' }],
        nextPage: null,
      },
    }
    vi.mocked(fetchListRepos).mockResolvedValue(mockData)

    await handleListRepos({
      all: false,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 3,
      perPage: 10,
      sort: 'name',
    })

    expect(outputListRepos).toHaveBeenCalledWith(
      mockData,
      'json',
      3,
      null,
      'name',
      10,
      'asc',
    )
  })

  it('handles markdown output', async () => {
    const { fetchListAllRepos } = await import('../../src/fetch-list-all-repos.mts')
    const { outputListRepos } = await import('../../src/output-list-repos.mts')

    const mockData = {
      ok: true,
      data: [{ id: '1', name: 'repo1' }],
    }
    vi.mocked(fetchListAllRepos).mockResolvedValue(mockData)

    await handleListRepos({
      all: true,
      direction: 'desc',
      orgSlug: 'test-org',
      outputKind: 'markdown',
      page: 1,
      perPage: 10,
      sort: 'created',
    })

    expect(outputListRepos).toHaveBeenCalledWith(
      mockData,
      'markdown',
      0,
      0,
      'created',
      Number.POSITIVE_INFINITY,
      'desc',
    )
  })

  it('handles different sort options', async () => {
    const { fetchListRepos } = await import('../../src/fetch-list-repos.mts')

    const sortOptions = ['name', 'created', 'updated', 'pushed']

    for (const sort of sortOptions) {
      vi.mocked(fetchListRepos).mockResolvedValue({
        ok: true,
        data: { repos: [], nextPage: null },
      })

      // eslint-disable-next-line no-await-in-loop
      await handleListRepos({
        all: false,
        direction: 'asc',
        orgSlug: 'test-org',
        outputKind: 'json',
        page: 1,
        perPage: 10,
        sort,
      })

      expect(fetchListRepos).toHaveBeenCalledWith(
        expect.objectContaining({ sort }),
      )
    }
  })

  it('handles different page sizes', async () => {
    const { fetchListRepos } = await import('../../src/fetch-list-repos.mts')
    const { outputListRepos } = await import('../../src/output-list-repos.mts')

    const mockData = {
      ok: true,
      data: { repos: [], nextPage: null },
    }
    vi.mocked(fetchListRepos).mockResolvedValue(mockData)

    await handleListRepos({
      all: false,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 100,
      sort: 'name',
    })

    expect(fetchListRepos).toHaveBeenCalledWith(
      expect.objectContaining({ perPage: 100 }),
    )
    expect(outputListRepos).toHaveBeenCalledWith(
      mockData,
      'json',
      1,
      null,
      'name',
      100,
      'asc',
    )
  })
})
