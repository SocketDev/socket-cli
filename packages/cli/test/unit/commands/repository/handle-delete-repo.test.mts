import { describe, expect, it, vi } from 'vitest'

import { createSuccessResult } from '../../../../src/helpers/mocks.mts'
import { handleDeleteRepo } from '../../../../../src/commands/repository/handle-delete-repo.mts'

// Mock the dependencies.
vi.mock('../../../../../src/commands/repository/fetch-delete-repo.mts', () => ({
  fetchDeleteRepo: vi.fn(),
}))

vi.mock('../../../../../src/commands/repository/output-delete-repo.mts', () => ({
  outputDeleteRepo: vi.fn(),
}))

describe('handleDeleteRepo', () => {
  it('deletes repository and outputs result successfully', async () => {
    const { fetchDeleteRepo } = await import('../../src/fetch-delete-repo.mts')
    const { outputDeleteRepo } = await import('../../src/output-delete-repo.mts')
    const mockFetch = vi.mocked(fetchDeleteRepo)
    const mockOutput = vi.mocked(outputDeleteRepo)

    const mockResult = createSuccessResult({ success: true })
    mockFetch.mockResolvedValue(mockResult)

    await handleDeleteRepo('test-org', 'test-repo', 'json')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'test-repo')
    expect(mockOutput).toHaveBeenCalledWith(mockResult, 'test-repo', 'json')
  })

  it('handles deletion failure', async () => {
    const { fetchDeleteRepo } = await import('../../src/fetch-delete-repo.mts')
    const { outputDeleteRepo } = await import('../../src/output-delete-repo.mts')
    const mockFetch = vi.mocked(fetchDeleteRepo)
    const mockOutput = vi.mocked(outputDeleteRepo)

    const mockResult = {
      ok: false,
      error: 'Repository not found',
    }
    mockFetch.mockResolvedValue(mockResult)

    await handleDeleteRepo('test-org', 'nonexistent-repo', 'text')

    expect(mockFetch).toHaveBeenCalledWith('test-org', 'nonexistent-repo')
    expect(mockOutput).toHaveBeenCalledWith(
      mockResult,
      'nonexistent-repo',
      'text',
    )
  })

  it('handles markdown output format', async () => {
    const { fetchDeleteRepo } = await import('../../src/fetch-delete-repo.mts')
    const { outputDeleteRepo } = await import('../../src/output-delete-repo.mts')
    const mockFetch = vi.mocked(fetchDeleteRepo)
    const mockOutput = vi.mocked(outputDeleteRepo)

    mockFetch.mockResolvedValue(createSuccessResult({}))

    await handleDeleteRepo('my-org', 'my-repo', 'markdown')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      'my-repo',
      'markdown',
    )
  })

  it('handles different repository names', async () => {
    const { fetchDeleteRepo } = await import('../../src/fetch-delete-repo.mts')
    const { outputDeleteRepo } = await import('../../src/output-delete-repo.mts')
    const mockFetch = vi.mocked(fetchDeleteRepo)
    const _mockOutput = vi.mocked(outputDeleteRepo)

    const repoNames = [
      'simple-repo',
      'repo-with-dashes',
      'repo_with_underscores',
      'repo123',
    ]

    for (const repoName of repoNames) {
      mockFetch.mockResolvedValue(createSuccessResult({}))
      // eslint-disable-next-line no-await-in-loop
      await handleDeleteRepo('test-org', repoName, 'json')
      expect(mockFetch).toHaveBeenCalledWith('test-org', repoName)
    }
  })

  it('passes text output format', async () => {
    const { fetchDeleteRepo } = await import('../../src/fetch-delete-repo.mts')
    const { outputDeleteRepo } = await import('../../src/output-delete-repo.mts')
    const mockFetch = vi.mocked(fetchDeleteRepo)
    const mockOutput = vi.mocked(outputDeleteRepo)

    mockFetch.mockResolvedValue(
      createSuccessResult({ deleted: true, timestamp: '2025-01-01T00:00:00Z' }),
    )

    await handleDeleteRepo('production-org', 'deprecated-repo', 'text')

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ deleted: true }),
      }),
      'deprecated-repo',
      'text',
    )
  })
})
