import { describe, expect, it, vi } from 'vitest'

import { handleViewRepo } from './handle-view-repo.mts'

// Mock the dependencies.
vi.mock('./fetch-view-repo.mts', () => ({
  fetchViewRepo: vi.fn(),
}))

vi.mock('./output-view-repo.mts', () => ({
  outputViewRepo: vi.fn(),
}))

describe('handleViewRepo', () => {
  it('fetches and outputs repository details successfully', async () => {
    const { fetchViewRepo } = await import('./fetch-view-repo.mts')
    const { outputViewRepo } = await import('./output-view-repo.mts')
    const mockFetch = vi.mocked(fetchViewRepo)
    const mockOutput = vi.mocked(outputViewRepo)

    const mockRepoData = {
      ok: true,
      data: {
        id: 'repo-123',
        name: 'test-repo',
        org: 'test-org',
        url: 'https://github.com/test-org/test-repo',
        lastUpdated: '2025-01-01T00:00:00Z',
      },
    }
    mockFetch.mockResolvedValue(mockRepoData)

    await handleViewRepo('test-org', 'test-repo', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'test-repo')
    expect(mockOutput).toHaveBeenCalledWith(mockRepoData, 'json')
  })

  it('handles fetch failure', async () => {
    const { fetchViewRepo } = await import('./fetch-view-repo.mts')
    const { outputViewRepo } = await import('./output-view-repo.mts')
    const mockFetch = vi.mocked(fetchViewRepo)
    const mockOutput = vi.mocked(outputViewRepo)

    const mockError = {
      ok: false,
      error: 'Repository not found',
    }
    mockFetch.mockResolvedValue(mockError)

    await handleViewRepo('test-org', 'nonexistent-repo', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'nonexistent-repo')
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchViewRepo } = await import('./fetch-view-repo.mts')
    const { outputViewRepo } = await import('./output-view-repo.mts')
    const mockFetch = vi.mocked(fetchViewRepo)
    const mockOutput = vi.mocked(outputViewRepo)

    mockFetch.mockResolvedValue({
      ok: true,
      data: {
        name: 'my-repo',
        org: 'my-org',
      },
    })

    await handleViewRepo('my-org', 'my-repo', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      'markdown',
    )
  })

  it('handles text output format', async () => {
    const { fetchViewRepo } = await import('./fetch-view-repo.mts')
    const { outputViewRepo } = await import('./output-view-repo.mts')
    const mockFetch = vi.mocked(fetchViewRepo)
    const mockOutput = vi.mocked(outputViewRepo)

    mockFetch.mockResolvedValue({
      ok: true,
      data: {
        name: 'production-repo',
        org: 'production-org',
        branches: ['main', 'develop', 'staging'],
        defaultBranch: 'main',
      },
    })

    await handleViewRepo('production-org', 'production-repo', 'text')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          name: 'production-repo',
        }),
      }),
      'text',
    )
  })

  it('handles different repository names', async () => {
    const { fetchViewRepo } = await import('./fetch-view-repo.mts')
    const mockFetch = vi.mocked(fetchViewRepo)

    const testCases = [
      ['org-1', 'repo-1'],
      ['my-org', 'my-awesome-project'],
      ['company', 'internal-tool'],
    ]

    for (const [org, repo] of testCases) {
      mockFetch.mockResolvedValue({ ok: true, data: {} })
      // eslint-disable-next-line no-await-in-loop
      await handleViewRepo(org, repo, 'json')
      expect(mockFetch).toHaveBeenCalledWith(org, repo)
    }
  })
})
