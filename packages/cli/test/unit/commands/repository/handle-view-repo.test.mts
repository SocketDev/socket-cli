/**
 * Unit tests for handleViewRepo.
 *
 * Purpose:
 * Tests the handler that orchestrates repository viewing. Validates fetch-process-output
 * pipeline and detailed repository data formatting.
 *
 * Test Coverage:
 * - Successful repository view flow
 * - Fetch failure handling
 * - Output formatting delegation
 * - Detailed data presentation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 *
 * Related Files:
 * - src/commands/repository/handle-view-repo.mts (implementation)
 * - src/commands/repository/fetch-view-repo.mts (API fetcher)
 * - src/commands/repository/output-view-repo.mts (formatter)
 */

import { describe, expect, it, vi } from 'vitest'

import { createSuccessResult } from '../../../../../src/commands/../../../test/helpers/index.mts'
import { handleViewRepo } from '../../../../src/commands/repository/handle-view-repo.mts'

// Setup mocks at module level
const mockFetchViewRepo = vi.hoisted(() => vi.fn())
const mockOutputViewRepo = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/repository/fetch-view-repo.mts', () => ({
  fetchViewRepo: mockFetchViewRepo,
}))

vi.mock('../../../../src/commands/repository/output-view-repo.mts', () => ({
  outputViewRepo: mockOutputViewRepo,
}))

describe('handleViewRepo', () => {
  it('fetches and outputs repository details successfully', async () => {    const mockRepoData = createSuccessResult({
      id: 'repo-123',
      name: 'test-repo',
      org: 'test-org',
      url: 'https://github.com/test-org/test-repo',
      lastUpdated: '2025-01-01T00:00:00Z',
    })

    mockFetchViewRepo.mockResolvedValue(mockRepoData)

    await handleViewRepo('test-org', 'test-repo', 'json')

    expect(mockFetchViewRepo).toHaveBeenCalledWith('test-org', 'test-repo')
    expect(mockOutputViewRepo).toHaveBeenCalledWith(mockRepoData, 'json')
  })

  it('handles fetch failure', async () => {    const mockError = {
      ok: false as const,
      message: 'Repository not found',
      code: 404,
    }

    mockFetchViewRepo.mockResolvedValue(mockError)

    await handleViewRepo('test-org', 'nonexistent-repo', 'text')

    expect(mockFetchViewRepo).toHaveBeenCalledWith('test-org', 'nonexistent-repo')
    expect(mockOutputViewRepo).toHaveBeenCalledWith(mockError, 'text')
  })

  it('handles markdown output format', async () => {    mockFetchViewRepo.mockResolvedValue(
      createSuccessResult({
        name: 'my-repo',
        org: 'my-org',
      }),
    )

    await handleViewRepo('my-org', 'my-repo', 'markdown')

    expect(mockOutputViewRepo).toHaveBeenCalledWith(expect.any(Object), 'markdown')
  })

  it('handles text output format', async () => {    mockFetchViewRepo.mockResolvedValue(
      createSuccessResult({
        name: 'production-repo',
        org: 'production-org',
        branches: ['main', 'develop', 'staging'],
        defaultBranch: 'main',
      }),
    )

    await handleViewRepo('production-org', 'production-repo', 'text')

    expect(mockOutputViewRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          name: 'production-repo',
        }),
      }),
      'text',
    )
  })

  it('handles different repository names', async () => {    const testCases = [
      ['org-1', 'repo-1'],
      ['my-org', 'my-awesome-project'],
      ['company', 'internal-tool'],
    ]

    for (const [org, repo] of testCases) {
      mockFetchViewRepo.mockResolvedValue(createSuccessResult({}))
      // eslint-disable-next-line no-await-in-loop
      await handleViewRepo(org, repo, 'json')
      expect(mockFetchViewRepo).toHaveBeenCalledWith(org, repo)
    }
  })
})
