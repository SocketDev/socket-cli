import { describe, expect, it, vi } from 'vitest'

import { handleUpdateRepo } from './handle-update-repo.mts'

// Mock the dependencies.
vi.mock('./fetch-update-repo.mts', () => ({
  fetchUpdateRepo: vi.fn(),
}))

vi.mock('./output-update-repo.mts', () => ({
  outputUpdateRepo: vi.fn(),
}))

describe('handleUpdateRepo', () => {
  it('updates repository and outputs result successfully', async () => {
    const { fetchUpdateRepo } = await import('./fetch-update-repo.mts')
    const { outputUpdateRepo } = await import('./output-update-repo.mts')
    const mockFetch = vi.mocked(fetchUpdateRepo)
    const mockOutput = vi.mocked(outputUpdateRepo)

    const mockResult = {
      ok: true,
      data: {
        id: 'repo-123',
        name: 'test-repo',
        description: 'Updated description',
        homepage: 'https://example.com',
        defaultBranch: 'main',
        visibility: 'public',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    }
    mockFetch.mockResolvedValue(mockResult)

    const params = {
      orgSlug: 'test-org',
      repoName: 'test-repo',
      description: 'Updated description',
      homepage: 'https://example.com',
      defaultBranch: 'main',
      visibility: 'public',
    }

    await handleUpdateRepo(params, 'json')

    expect(mockFetch).toHaveBeenCalledWith(params)
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'test-repo', 'json')
  })

  it('handles update failure', async () => {
    const { fetchUpdateRepo } = await import('./fetch-update-repo.mts')
    const { outputUpdateRepo } = await import('./output-update-repo.mts')
    const mockFetch = vi.mocked(fetchUpdateRepo)
    const mockOutput = vi.mocked(outputUpdateRepo)

    const mockError = {
      ok: false,
      error: 'Repository not found',
    }
    mockFetch.mockResolvedValue(mockError)

    const params = {
      orgSlug: 'test-org',
      repoName: 'nonexistent',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'private',
    }

    await handleUpdateRepo(params, 'text')

    expect(mockFetch).toHaveBeenCalledWith(params)
    expect(mockOutput).toHaveBeenCalledWith(mockError, 'nonexistent', 'text')
  })

  it('handles markdown output format', async () => {
    const { fetchUpdateRepo } = await import('./fetch-update-repo.mts')
    const { outputUpdateRepo } = await import('./output-update-repo.mts')
    const mockFetch = vi.mocked(fetchUpdateRepo)
    const mockOutput = vi.mocked(outputUpdateRepo)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    await handleUpdateRepo(
      {
        orgSlug: 'my-org',
        repoName: 'my-repo',
        description: 'A cool project',
        homepage: 'https://myproject.com',
        defaultBranch: 'develop',
        visibility: 'public',
      },
      'markdown',
    )

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      'my-repo',
      'markdown',
    )
  })

  it('handles different visibility settings', async () => {
    const { fetchUpdateRepo } = await import('./fetch-update-repo.mts')
    const mockFetch = vi.mocked(fetchUpdateRepo)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    const visibilities = ['public', 'private', 'internal']

    for (const visibility of visibilities) {
      // eslint-disable-next-line no-await-in-loop
      await handleUpdateRepo(
        {
          orgSlug: 'test-org',
          repoName: 'test-repo',
          description: 'Test',
          homepage: '',
          defaultBranch: 'main',
          visibility,
        },
        'json',
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      )
    }
  })

  it('handles different default branches', async () => {
    const { fetchUpdateRepo } = await import('./fetch-update-repo.mts')
    const { outputUpdateRepo } = await import('./output-update-repo.mts')
    const mockFetch = vi.mocked(fetchUpdateRepo)
    const mockOutput = vi.mocked(outputUpdateRepo)

    mockFetch.mockResolvedValue({
      ok: true,
      data: { defaultBranch: 'develop' },
    })

    await handleUpdateRepo(
      {
        orgSlug: 'production-org',
        repoName: 'production-repo',
        description: 'Production application',
        homepage: 'https://production.app',
        defaultBranch: 'develop',
        visibility: 'private',
      },
      'text',
    )

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultBranch: 'develop',
      }),
    )
    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ defaultBranch: 'develop' }),
      }),
      'production-repo',
      'text',
    )
  })
})
