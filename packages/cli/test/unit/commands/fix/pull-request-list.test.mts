/**
 * Unit Tests: Listing Automated Fix Pull Requests.
 *
 * Purpose: Tests the GraphQL-backed lookup of open/closed/merged pull
 * requests created by the Socket fix workflow. Validates branch-pattern
 * matching, author filtering, pagination early-exit, and GraphQL error
 * handling.
 *
 * Test Coverage: - Matching PRs by Socket fix branch pattern - Filtering by
 * PR author - Graceful handling of GraphQL errors - Empty and missing-author
 * response shapes - Early pagination exit once a GHSA match is found - A
 * null pullRequests payload.
 *
 * Testing Approach: Mocks the GraphQL cache fetch, branch-pattern matcher,
 * and GraphQL error handler to test the orchestration logic without actual
 * GitHub API calls.
 *
 * Related Files: - src/commands/fix/pull-request.mts - PR lookup logic -
 * src/commands/fix/git.mts - Socket fix branch pattern -
 * src/util/git/github.mts - Octokit GraphQL client factory.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSocketFixPrs } from '../../../../src/commands/fix/pull-request.mts'

const mockGetSocketFixBranchPattern = vi.hoisted(() =>
  vi.fn(() => /^socket\/fix\/GHSA-.*/),
)

// Mock dependencies.
vi.mock(import('../../../../src/commands/fix/git.mts'), () => ({
  getSocketFixBranchPattern: mockGetSocketFixBranchPattern,
}))

// Mock debug.
vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

const mockGetOctokitGraphql = vi.hoisted(() => vi.fn())
const mockCacheFetch = vi.hoisted(() => vi.fn())
const mockHandleGraphqlError = vi.hoisted(() =>
  vi.fn(() => ({ ok: false, message: 'GraphQL error' })),
)

vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  cacheFetch: mockCacheFetch,
  getOctokitGraphql: mockGetOctokitGraphql,
  handleGraphqlError: mockHandleGraphqlError,
}))

describe('pull-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSocketFixPrs', () => {
    beforeEach(() => {
      mockGetOctokitGraphql.mockReturnValue(vi.fn())
    })

    it('returns matching PRs', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                author: { login: 'testuser' },
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-xxxx-xxxx-xxxx',
                mergeStateStatus: 'CLEAN',
                number: 1,
                state: 'OPEN',
                title: 'Fix GHSA-xxxx',
              },
              {
                author: { login: 'otheruser' },
                baseRefName: 'main',
                headRefName: 'feature-branch',
                mergeStateStatus: 'CLEAN',
                number: 2,
                state: 'OPEN',
                title: 'Other PR',
              },
            ],
          },
        },
      })

      const result = await getSocketFixPrs('owner', 'repo')

      expect(result).toHaveLength(1)
      expect(result[0]?.number).toBe(1)
    })

    it('filters by author', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                author: { login: 'testuser' },
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-xxxx',
                mergeStateStatus: 'CLEAN',
                number: 1,
                state: 'OPEN',
                title: 'Fix GHSA-xxxx',
              },
              {
                author: { login: 'otheruser' },
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-yyyy',
                mergeStateStatus: 'CLEAN',
                number: 2,
                state: 'OPEN',
                title: 'Fix GHSA-yyyy',
              },
            ],
          },
        },
      })

      const result = await getSocketFixPrs('owner', 'repo', {
        author: 'testuser',
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.author).toBe('testuser')
    })

    it('handles GraphQL errors gracefully', async () => {
      mockCacheFetch.mockRejectedValueOnce(new Error('GraphQL error'))

      const result = await getSocketFixPrs('owner', 'repo')

      expect(result).toEqual([])
      expect(mockHandleGraphqlError).toHaveBeenCalled()
    })

    it('handles empty response', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [],
          },
        },
      })

      const result = await getSocketFixPrs('owner', 'repo')

      expect(result).toEqual([])
    })

    it('handles missing author in node', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                author: undefined,
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-xxxx',
                mergeStateStatus: 'CLEAN',
                number: 1,
                state: 'OPEN',
                title: 'Fix GHSA-xxxx',
              },
            ],
          },
        },
      })

      const result = await getSocketFixPrs('owner', 'repo')

      expect(result).toHaveLength(1)
      // UNKNOWN_VALUE from @socketsecurity/lib/constants/core.
      expect(result[0]?.author).toBe('<unknown>')
    })

    it('stops pagination early when ghsaId match found', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: 'cursor1' },
            nodes: [
              {
                author: { login: 'user1' },
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-xxxx',
                mergeStateStatus: 'CLEAN',
                number: 1,
                state: 'OPEN',
                title: 'Fix GHSA-xxxx',
              },
            ],
          },
        },
      })

      const result = await getSocketFixPrs('owner', 'repo', {
        ghsaId: 'GHSA-xxxx',
      })

      expect(result).toHaveLength(1)
      // Should have only called cacheFetch once due to early exit.
      expect(mockCacheFetch).toHaveBeenCalledTimes(1)
    })

    it('handles null pullRequests response', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: undefined,
        },
      })

      const result = await getSocketFixPrs('owner', 'repo')

      expect(result).toEqual([])
    })
  })
})
