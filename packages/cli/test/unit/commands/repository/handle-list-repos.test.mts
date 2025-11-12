/**
 * Unit tests for handleListRepos.
 *
 * Purpose:
 * Tests the handler that orchestrates repository listing. Validates pagination handling,
 * filtering, and output formatting for repository lists.
 *
 * Test Coverage:
 * - Successful repository listing flow
 * - Pagination configuration
 * - Fetch failure handling
 * - Output formatting delegation
 * - Filtering and sorting options
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic. Tests
 * paginated data handling.
 *
 * Related Files:
 * - src/commands/repository/handle-list-repos.mts (implementation)
 * - src/commands/repository/fetch-list-repos.mts (API fetcher)
 * - src/commands/repository/output-list-repos.mts (formatter)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleListRepos } from '../../../../src/commands/repository/handle-list-repos.mts'

// Mock the dependencies.
const mockFetchListAllRepos = vi.hoisted(() => vi.fn())
const mockFetchListRepos = vi.hoisted(() => vi.fn())
const mockOutputListRepos = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/repository/fetch-list-all-repos.mts', () => ({
  fetchListAllRepos: mockFetchListAllRepos,
}))
vi.mock('../../../../src/commands/repository/fetch-list-repos.mts', () => ({
  fetchListRepos: mockFetchListRepos,
}))
vi.mock('../../../../src/commands/repository/output-list-repos.mts', () => ({
  outputListRepos: mockOutputListRepos,
}))

describe('handleListRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches all repositories when all flag is true', async () => {
    const mockData = {
      ok: true,
      data: [
        { id: '1', name: 'repo1' },
        { id: '2', name: 'repo2' },
        { id: '3', name: 'repo3' },
      ],
    }
    mockFetchListAllRepos.mockResolvedValue(mockData)

    await handleListRepos({
      all: true,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
      sort: 'name',
    })

    expect(mockFetchListAllRepos).toHaveBeenCalledWith('test-org', {
      direction: 'asc',
      sort: 'name',
    })
    expect(mockOutputListRepos).toHaveBeenCalledWith(
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
    mockFetchListRepos.mockResolvedValue(mockData)

    await handleListRepos({
      all: false,
      direction: 'desc',
      orgSlug: 'test-org',
      outputKind: 'text',
      page: 1,
      perPage: 10,
      sort: 'updated',
    })

    expect(mockFetchListRepos).toHaveBeenCalledWith({
      direction: 'desc',
      orgSlug: 'test-org',
      page: 1,
      perPage: 10,
      sort: 'updated',
    })
    expect(mockOutputListRepos).toHaveBeenCalledWith(
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
    const mockError = {
      ok: false,
      error: new Error('Failed to fetch repositories'),
    }
    mockFetchListRepos.mockResolvedValue(mockError)

    await handleListRepos({
      all: false,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 20,
      sort: 'name',
    })

    expect(mockOutputListRepos).toHaveBeenCalledWith(
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
    const mockData = {
      ok: true,
      data: {
        repos: [{ id: '1', name: 'repo1' }],
        nextPage: null,
      },
    }
    mockFetchListRepos.mockResolvedValue(mockData)

    await handleListRepos({
      all: false,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 3,
      perPage: 10,
      sort: 'name',
    })

    expect(mockOutputListRepos).toHaveBeenCalledWith(
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
    const mockData = {
      ok: true,
      data: [{ id: '1', name: 'repo1' }],
    }
    mockFetchListAllRepos.mockResolvedValue(mockData)

    await handleListRepos({
      all: true,
      direction: 'desc',
      orgSlug: 'test-org',
      outputKind: 'markdown',
      page: 1,
      perPage: 10,
      sort: 'created',
    })

    expect(mockOutputListRepos).toHaveBeenCalledWith(
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
    const sortOptions = ['name', 'created', 'updated', 'pushed']

    for (const sort of sortOptions) {
      mockFetchListRepos.mockResolvedValue({
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

      expect(mockFetchListRepos).toHaveBeenCalledWith(
        expect.objectContaining({ sort }),
      )
    }
  })

  it('handles different page sizes', async () => {
    const mockData = {
      ok: true,
      data: { repos: [], nextPage: null },
    }
    mockFetchListRepos.mockResolvedValue(mockData)

    await handleListRepos({
      all: false,
      direction: 'asc',
      orgSlug: 'test-org',
      outputKind: 'json',
      page: 1,
      perPage: 100,
      sort: 'name',
    })

    expect(mockFetchListRepos).toHaveBeenCalledWith(
      expect.objectContaining({ perPage: 100 }),
    )
    expect(mockOutputListRepos).toHaveBeenCalledWith(
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
