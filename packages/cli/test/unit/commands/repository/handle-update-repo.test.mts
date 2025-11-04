import { describe, expect, it, vi } from 'vitest'

import { createSuccessResult } from '../../../helpers/mocks.mts'
import { handleUpdateRepo } from '../../../../src/commands/repository/handle-update-repo.mts'

// Mock the dependencies.
const mockFetchUpdateRepo = vi.hoisted(() => vi.fn())
const mockOutputUpdateRepo = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/repository/fetch-update-repo.mts', () => ({
  fetchUpdateRepo: mockFetchUpdateRepo,
}))

vi.mock('../../../../src/commands/repository/output-update-repo.mts', () => ({
  outputUpdateRepo: mockOutputUpdateRepo,
}))

describe('handleUpdateRepo', () => {
  it('updates repository and outputs result successfully', async () => {    const mockResult = createSuccessResult({
      id: 'repo-123',
      name: 'test-repo',
      description: 'Updated description',
      homepage: 'https://example.com',
      defaultBranch: 'main',
      visibility: 'public',
      updatedAt: '2025-01-01T00:00:00Z',
    })
    mockFetchUpdateRepo.mockResolvedValue(mockResult)

    const params = {
      orgSlug: 'test-org',
      repoName: 'test-repo',
      description: 'Updated description',
      homepage: 'https://example.com',
      defaultBranch: 'main',
      visibility: 'public',
    }

    await handleUpdateRepo(params, 'json')

    expect(mockFetchUpdateRepo).toHaveBeenCalledWith(params)
    expect(mockOutputUpdateRepo).toHaveBeenCalledWith(mockResult, 'test-repo', 'json')
  })

  it('handles update failure', async () => {    const mockError = {
      ok: false,
      error: 'Repository not found',
    }
    mockFetchUpdateRepo.mockResolvedValue(mockError)

    const params = {
      orgSlug: 'test-org',
      repoName: 'nonexistent',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'private',
    }

    await handleUpdateRepo(params, 'text')

    expect(mockFetchUpdateRepo).toHaveBeenCalledWith(params)
    expect(mockOutputUpdateRepo).toHaveBeenCalledWith(mockError, 'nonexistent', 'text')
  })

  it('handles markdown output format', async () => {    mockFetchUpdateRepo.mockResolvedValue(createSuccessResult({}))

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

    expect(mockOutputUpdateRepo).toHaveBeenCalledWith(
      expect.any(Object),
      'my-repo',
      'markdown',
    )
  })

  it('handles different visibility settings', async () => {    mockFetchUpdateRepo.mockResolvedValue(createSuccessResult({}))

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

      expect(mockFetchUpdateRepo).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      )
    }
  })

  it('handles different default branches', async () => {    mockFetchUpdateRepo.mockResolvedValue(
      createSuccessResult({ defaultBranch: 'develop' }),
    )

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

    expect(mockFetchUpdateRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultBranch: 'develop',
      }),
    )
    expect(mockOutputUpdateRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ defaultBranch: 'develop' }),
      }),
      'production-repo',
      'text',
    )
  })
})
