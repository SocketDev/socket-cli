/**
 * Unit tests for GitHubProvider.listPrs advanced scenarios.
 *
 * Purpose: Tests GraphQL-backed PR listing edge cases — author filtering,
 * missing-author fallback, state filtering, the ghsaId early-exit
 * optimization, an empty repository response, and GraphQL failure handling.
 *
 * Related Files: - util/git/github-provider.mts (implementation)
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
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

  describe('listPrs advanced scenarios', () => {
    it('filters PRs by author', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                number: 1,
                title: 'PR by user1',
                author: { login: 'user1' },
                headRefName: 'f1',
                baseRefName: 'main',
                state: 'OPEN',
                mergeStateStatus: 'CLEAN',
              },
              {
                number: 2,
                title: 'PR by user2',
                author: { login: 'user2' },
                headRefName: 'f2',
                baseRefName: 'main',
                state: 'OPEN',
                mergeStateStatus: 'CLEAN',
              },
            ],
          },
        },
      }

      mockCacheFetch.mockResolvedValue(mockResponse)

      const provider = new GitHubProvider()
      const results = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
        author: 'user1',
      })

      expect(results).toHaveLength(1)
      expect(results[0].author).toBe('user1')
    })

    it('handles PRs without author', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                number: 1,
                title: 'PR without author',
                // No author field.
                headRefName: 'f1',
                baseRefName: 'main',
                state: 'OPEN',
                mergeStateStatus: 'CLEAN',
              },
            ],
          },
        },
      }

      mockCacheFetch.mockResolvedValue(mockResponse)

      const provider = new GitHubProvider()
      const results = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(results).toHaveLength(1)
      expect(results[0].author).toBe('<unknown>')
    })

    it('handles specific states filter', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                number: 1,
                title: 'Open PR',
                author: { login: 'user' },
                headRefName: 'f1',
                baseRefName: 'main',
                state: 'OPEN',
                mergeStateStatus: 'CLEAN',
              },
            ],
          },
        },
      }

      mockCacheFetch.mockResolvedValue(mockResponse)

      const provider = new GitHubProvider()
      const results = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
        states: 'open',
      })

      expect(results).toHaveLength(1)
    })

    it('exits early when ghsaId provided and matches found', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: 'cursor' },
            nodes: [
              {
                number: 1,
                title: 'Fix GHSA-1234',
                author: { login: 'user' },
                headRefName: 'socket/fix/GHSA-1234',
                baseRefName: 'main',
                state: 'OPEN',
                mergeStateStatus: 'CLEAN',
              },
            ],
          },
        },
      }

      mockCacheFetch.mockResolvedValue(mockResponse)

      const provider = new GitHubProvider()
      const results = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
        ghsaId: 'GHSA-1234',
      })

      // Should have exited early after first page due to ghsaId optimization.
      expect(mockCacheFetch).toHaveBeenCalledTimes(1)
      expect(results).toHaveLength(1)
    })

    it('handles empty repository response', async () => {
      mockCacheFetch.mockResolvedValue({
        repository: {
          pullRequests: undefined,
        },
      })

      const provider = new GitHubProvider()
      const results = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(results).toHaveLength(0)
    })

    it('handles GraphQL error gracefully', async () => {
      mockCacheFetch.mockRejectedValue(new Error('GraphQL error'))

      const provider = new GitHubProvider()
      const results = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(results).toHaveLength(0)
    })
  })
})
