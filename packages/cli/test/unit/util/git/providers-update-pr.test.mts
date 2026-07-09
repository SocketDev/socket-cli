/**
 * Unit tests for GitHubProvider.updatePr and its associated error-handling
 * paths on createPr / addComment.
 *
 * Purpose: Tests base-into-head merge updates (including conflict comments)
 * and the failure branches that surface a withGitHubRetry error as a thrown
 * exception.
 *
 * Related Files: - util/git/github-provider.mts (implementation)
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetOctokit = vi.hoisted(() => vi.fn())
const mockGetOctokitGraphql = vi.hoisted(() => vi.fn())
const mockCacheFetch = vi.hoisted(() => vi.fn())
const mockGitDeleteRemoteBranch = vi.hoisted(() => vi.fn())
const mockWithGitHubRetry = vi.hoisted(() =>
  vi.fn(async (operation: () => Promise<unknown>) => {
    const result = await operation()
    return { ok: true, data: result }
  }),
)

vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  cacheFetch: mockCacheFetch,
  getOctokit: mockGetOctokit,
  getOctokitGraphql: mockGetOctokitGraphql,
  handleGitHubApiError: vi.fn((e: unknown, context: string) => ({
    ok: false,
    message: 'GitHub API error',
    cause: `Error while ${context}: ${errorMessage(e)}`,
  })),
  handleGraphqlError: vi.fn((_e: unknown, context: string) => ({
    ok: false,
    message: 'GitHub GraphQL error',
    cause: `GraphQL error while ${context}`,
  })),
  withGitHubRetry: mockWithGitHubRetry,
}))

vi.mock(import('../../../../src/util/git/operations.mts'), () => ({
  gitDeleteRemoteBranch: mockGitDeleteRemoteBranch,
}))

import { GitHubProvider } from '../../../../src/util/git/github-provider.mts'

describe('GitHubProvider', () => {
  let mockOctokit: unknown
  let mockOctokitGraphql: unknown

  beforeEach(() => {
    mockOctokit = {
      pulls: {
        create: vi.fn(),
        get: vi.fn(),
      },
      repos: {
        merge: vi.fn(),
      },
      issues: {
        createComment: vi.fn(),
      },
    }

    mockOctokitGraphql = vi.fn()

    // Clear mocks AFTER creating new mock objects.
    vi.clearAllMocks()

    // Set up default mock return values.
    mockGetOctokit.mockReturnValue(mockOctokit)
    mockGetOctokitGraphql.mockReturnValue(mockOctokitGraphql)
  })

  describe('updatePr', () => {
    it('updates PR by merging base into head', async () => {
      mockOctokit.repos.merge.mockResolvedValue({})
      mockOctokit.pulls.get.mockResolvedValue({
        data: { mergeable_state: 'clean' },
      })

      const provider = new GitHubProvider()
      await provider.updatePr({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
        head: 'feature-branch',
        base: 'main',
      })

      expect(mockOctokit.repos.merge).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        head: 'main',
        base: 'feature-branch',
      })
    })

    it('adds conflict comment when PR becomes dirty', async () => {
      mockOctokit.repos.merge.mockResolvedValue({})
      mockOctokit.pulls.get.mockResolvedValue({
        data: { mergeable_state: 'dirty' },
      })
      mockOctokit.issues.createComment.mockResolvedValue({})

      const provider = new GitHubProvider()
      await provider.updatePr({
        owner: 'owner',
        repo: 'repo',
        prNumber: 456,
        head: 'feature-branch',
        base: 'main',
      })

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 456,
          body: expect.stringContaining('merge conflicts'),
        }),
      )
    })

    it('throws when merge fails', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'Merge failed',
        cause: 'Conflict',
      })

      const provider = new GitHubProvider()
      await expect(
        provider.updatePr({
          owner: 'owner',
          repo: 'repo',
          prNumber: 789,
          head: 'feature',
          base: 'main',
        }),
      ).rejects.toThrow()
    })

    it('throws when PR details fetch fails', async () => {
      mockWithGitHubRetry
        .mockResolvedValueOnce({ ok: true, data: {} })
        .mockResolvedValueOnce({
          ok: false,
          message: 'PR not found',
        })

      const provider = new GitHubProvider()
      await expect(
        provider.updatePr({
          owner: 'owner',
          repo: 'repo',
          prNumber: 999,
          head: 'feature',
          base: 'main',
        }),
      ).rejects.toThrow()
    })
  })

  describe('createPr error handling', () => {
    it('throws when API call fails', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'Failed to create PR',
        cause: 'Repository not found',
      })

      const provider = new GitHubProvider()
      await expect(
        provider.createPr({
          owner: 'owner',
          repo: 'nonexistent',
          title: 'Test',
          head: 'feature',
          base: 'main',
          body: 'Body',
        }),
      ).rejects.toThrow('Repository not found')
    })

    it('handles closed PR state', async () => {
      mockOctokit.pulls.create.mockResolvedValue({
        data: {
          number: 789,
          html_url: 'https://github.com/owner/repo/pull/789',
          state: 'closed',
          merged_at: undefined,
        },
      })

      const provider = new GitHubProvider()
      const result = await provider.createPr({
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
        head: 'feature',
        base: 'main',
        body: 'Body',
      })

      expect(result.state).toBe('closed')
    })
  })

  describe('addComment error handling', () => {
    it('throws when comment fails', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'Comment failed',
      })

      const provider = new GitHubProvider()
      await expect(
        provider.addComment({
          owner: 'owner',
          repo: 'repo',
          prNumber: 123,
          body: 'Test',
        }),
      ).rejects.toThrow('Comment failed')
    })
  })
})
