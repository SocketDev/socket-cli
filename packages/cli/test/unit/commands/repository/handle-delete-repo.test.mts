/**
 * Unit tests for handleDeleteRepo.
 *
 * Purpose:
 * Tests the handler that orchestrates repository deletion. Validates fetch-process-output
 * pipeline and confirmation workflows for destructive operations.
 *
 * Test Coverage:
 * - Successful repository deletion flow
 * - Fetch failure handling
 * - Output formatting delegation
 * - Deletion confirmation handling
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic. Tests
 * destructive operation handling.
 *
 * Related Files:
 * - src/commands/repository/handle-delete-repo.mts (implementation)
 * - src/commands/repository/fetch-delete-repo.mts (API fetcher)
 * - src/commands/repository/output-delete-repo.mts (formatter)
 */

import { describe, expect, it, vi } from 'vitest'

import { createSuccessResult } from '../../../../test/helpers/index.mts'

// Mock the dependencies.
const mockFetchDeleteRepo = vi.hoisted(() => vi.fn())
const mockOutputDeleteRepo = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/repository/fetch-delete-repo.mts', () => ({
  fetchDeleteRepo: mockFetchDeleteRepo,
}))

vi.mock('../../../../src/commands/repository/output-delete-repo.mts', () => ({
  outputDeleteRepo: mockOutputDeleteRepo,
}))

const { handleDeleteRepo } = await import(
  '../../../../src/commands/repository/handle-delete-repo.mts'
)

describe('handleDeleteRepo', () => {
  it('deletes repository and outputs result successfully', async () => {
    const mockResult = createSuccessResult({ success: true })
    mockFetchDeleteRepo.mockResolvedValue(mockResult)

    await handleDeleteRepo('test-org', 'test-repo', 'json')

    expect(mockFetchDeleteRepo).toHaveBeenCalledWith('test-org', 'test-repo')
    expect(mockOutputDeleteRepo).toHaveBeenCalledWith(
      mockResult,
      'test-repo',
      'json',
    )
  })

  it('handles deletion failure', async () => {
    const mockResult = {
      ok: false,
      error: 'Repository not found',
    }
    mockFetchDeleteRepo.mockResolvedValue(mockResult)

    await handleDeleteRepo('test-org', 'nonexistent-repo', 'text')

    expect(mockFetchDeleteRepo).toHaveBeenCalledWith(
      'test-org',
      'nonexistent-repo',
    )
    expect(mockOutputDeleteRepo).toHaveBeenCalledWith(
      mockResult,
      'nonexistent-repo',
      'text',
    )
  })

  it('handles markdown output format', async () => {
    mockFetchDeleteRepo.mockResolvedValue(createSuccessResult({}))

    await handleDeleteRepo('my-org', 'my-repo', 'markdown')

    expect(mockOutputDeleteRepo).toHaveBeenCalledWith(
      expect.any(Object),
      'my-repo',
      'markdown',
    )
  })

  it('handles different repository names', async () => {
    const repoNames = [
      'simple-repo',
      'repo-with-dashes',
      'repo_with_underscores',
      'repo123',
    ]

    for (const repoName of repoNames) {
      mockFetchDeleteRepo.mockResolvedValue(createSuccessResult({}))
      // eslint-disable-next-line no-await-in-loop
      await handleDeleteRepo('test-org', repoName, 'json')
      expect(mockFetchDeleteRepo).toHaveBeenCalledWith('test-org', repoName)
    }
  })

  it('passes text output format', async () => {
    mockFetchDeleteRepo.mockResolvedValue(
      createSuccessResult({ deleted: true, timestamp: '2025-01-01T00:00:00Z' }),
    )

    await handleDeleteRepo('production-org', 'deprecated-repo', 'text')

    expect(mockOutputDeleteRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ deleted: true }),
      }),
      'deprecated-repo',
      'text',
    )
  })
})
