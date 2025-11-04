/**
 * Unit tests for handleCreateRepo.
 *
 * Purpose:
 * Tests the handler that orchestrates repository creation. Validates fetch-process-output
 * pipeline, input validation, and error handling for repository creation workflows.
 *
 * Test Coverage:
 * - Successful repository creation flow
 * - Fetch failure handling
 * - Input validation
 * - Output formatting delegation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 *
 * Related Files:
 * - src/commands/repository/handle-create-repo.mts (implementation)
 * - src/commands/repository/fetch-create-repo.mts (API fetcher)
 * - src/commands/repository/output-create-repo.mts (formatter)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCreateRepo } from '../../../../src/commands/repository/handle-create-repo.mts'

// Mock the dependencies.
const mockFetchCreateRepo = vi.hoisted(() => vi.fn())
const mockOutputCreateRepo = vi.hoisted(() => vi.fn())
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => false)

vi.mock('../../../../src/commands/repository/fetch-create-repo.mts', () => ({
  fetchCreateRepo: mockFetchCreateRepo,
}))
vi.mock('../../../../src/commands/repository/output-create-repo.mts', () => ({
  outputCreateRepo: mockOutputCreateRepo,
}))
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
  isDebug: mockIsDebug,
}))

describe('handleCreateRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates repository successfully', async () => {
    const mockData = {
      ok: true,
      data: {
        id: '123',
        name: 'my-repo',
        fullName: 'test-org/my-repo',
        visibility: 'private',
      },
    }
    mockFetchCreateRepo.mockResolvedValue(mockData)

    await handleCreateRepo(
      {
        orgSlug: 'test-org',
        repoName: 'my-repo',
        description: 'Test repository',
        homepage: 'https://example.com',
        defaultBranch: 'main',
        visibility: 'private',
      },
      'json',
    )

    expect(mockFetchCreateRepo).toHaveBeenCalledWith({
      orgSlug: 'test-org',
      repoName: 'my-repo',
      description: 'Test repository',
      homepage: 'https://example.com',
      defaultBranch: 'main',
      visibility: 'private',
    })
    expect(mockOutputCreateRepo).toHaveBeenCalledWith(mockData, 'my-repo', 'json')
  })

  it('handles creation failure', async () => {
    const mockError = {
      ok: false,
      error: new Error('Repository already exists'),
    }
    mockFetchCreateRepo.mockResolvedValue(mockError)

    await handleCreateRepo(
      {
        orgSlug: 'test-org',
        repoName: 'existing-repo',
        description: 'Test repository',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'public',
      },
      'text',
    )

    expect(mockFetchCreateRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        repoName: 'existing-repo',
      }),
    )
    expect(mockOutputCreateRepo).toHaveBeenCalledWith(
      mockError,
      'existing-repo',
      'text',
    )
  })

  it('handles markdown output', async () => {
    const mockData = {
      ok: true,
      data: { id: '456', name: 'test-repo' },
    }
    mockFetchCreateRepo.mockResolvedValue(mockData)

    await handleCreateRepo(
      {
        orgSlug: 'org',
        repoName: 'test-repo',
        description: 'Description',
        homepage: 'https://test.com',
        defaultBranch: 'develop',
        visibility: 'internal',
      },
      'markdown',
    )

    expect(mockOutputCreateRepo).toHaveBeenCalledWith(
      mockData,
      'test-repo',
      'markdown',
    )
  })

  it('logs debug information', async () => {
    const mockData = {
      ok: true,
      data: { id: '789', name: 'debug-repo' },
    }
    mockFetchCreateRepo.mockResolvedValue(mockData)

    await handleCreateRepo(
      {
        orgSlug: 'debug-org',
        repoName: 'debug-repo',
        description: 'Debug test',
        homepage: 'https://debug.com',
        defaultBranch: 'main',
        visibility: 'private',
      },
      'json',
    )

    expect(mockDebug).toHaveBeenCalledWith(
      'Creating repository debug-org/debug-repo',
    )
    expect(mockDebugDir).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: 'debug-org',
        repoName: 'debug-repo',
      }),
    )
    expect(mockDebug).toHaveBeenCalledWith('Repository creation succeeded')
  })

  it('logs debug information on failure', async () => {
    mockFetchCreateRepo.mockResolvedValue({
      ok: false,
      error: new Error('Failed'),
    })

    await handleCreateRepo(
      {
        orgSlug: 'org',
        repoName: 'repo',
        description: '',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'public',
      },
      'json',
    )

    expect(mockDebug).toHaveBeenCalledWith('Repository creation failed')
  })

  it('handles different visibility types', async () => {
    const visibilities = ['public', 'private', 'internal']

    for (const visibility of visibilities) {
      mockFetchCreateRepo.mockResolvedValue({
        ok: true,
        data: { id: '1', name: 'repo', visibility },
      })

      // eslint-disable-next-line no-await-in-loop
      await handleCreateRepo(
        {
          orgSlug: 'org',
          repoName: 'repo',
          description: 'Test',
          homepage: '',
          defaultBranch: 'main',
          visibility,
        },
        'json',
      )

      expect(mockFetchCreateRepo).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      )
    }
  })

  it('handles empty optional fields', async () => {
    mockFetchCreateRepo.mockResolvedValue({
      ok: true,
      data: { id: '1', name: 'minimal-repo' },
    })

    await handleCreateRepo(
      {
        orgSlug: 'org',
        repoName: 'minimal-repo',
        description: '',
        homepage: '',
        defaultBranch: 'main',
        visibility: 'public',
      },
      'json',
    )

    expect(mockFetchCreateRepo).toHaveBeenCalledWith({
      orgSlug: 'org',
      repoName: 'minimal-repo',
      description: '',
      homepage: '',
      defaultBranch: 'main',
      visibility: 'public',
    })
  })
})
