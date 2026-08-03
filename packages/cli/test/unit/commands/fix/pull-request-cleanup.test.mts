/**
 * Unit Tests: Cleaning Up Automated Fix Pull Requests.
 *
 * Purpose: Tests the maintenance pass that keeps open Socket fix PRs current
 * and removes branches for PRs that have already merged. Validates
 * stale-branch updates, merged-branch deletion, and graceful handling when
 * either operation fails.
 *
 * Test Coverage: - No-op when no matching PRs exist - Updating PRs with a
 * BEHIND merge state - Deleting branches for merged PRs - Tolerating a
 * failed branch deletion - Tolerating a failed PR update.
 *
 * Testing Approach: Mocks the GraphQL cache fetch and PR provider
 * abstraction to test the orchestration logic without actual GitHub API
 * calls.
 *
 * Related Files: - src/commands/fix/pull-request.mts - PR cleanup logic -
 * src/commands/fix/git.mts - Socket fix branch pattern -
 * src/util/git/provider-factory.mts - Provider abstraction factory.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanupSocketFixPrs } from '../../../../src/commands/fix/pull-request.mts'

const mockCreatePrProvider = vi.hoisted(() => vi.fn())
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

// Mock pr-lifecycle-logger.
vi.mock(import('../../../../src/commands/fix/pr-lifecycle-logger.mts'), () => ({
  logPrEvent: vi.fn(),
}))

const mockGetOctokitGraphql = vi.hoisted(() => vi.fn())
const mockCacheFetch = vi.hoisted(() => vi.fn())
const mockWriteCache = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  cacheFetch: mockCacheFetch,
  getOctokitGraphql: mockGetOctokitGraphql,
  writeCache: mockWriteCache,
}))

vi.mock(import('../../../../src/util/git/provider-factory.mts'), () => ({
  createPrProvider: mockCreatePrProvider,
}))

describe('pull-request', () => {
  let mockProvider: unknown

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock provider.
    mockProvider = {
      createPr: vi.fn(),
      updatePr: vi.fn(),
      listPrs: vi.fn(),
      deleteBranch: vi.fn(),
      addComment: vi.fn(),
      getProviderName: vi.fn(() => 'github'),
      supportsGraphQL: vi.fn(() => true),
    }
  })

  describe('cleanupSocketFixPrs', () => {
    beforeEach(() => {
      mockGetOctokitGraphql.mockReturnValue(vi.fn())
      mockCreatePrProvider.mockReturnValue(mockProvider)
    })

    it('returns empty array when no matching PRs', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [],
          },
        },
      })

      const result = await cleanupSocketFixPrs('owner', 'repo', 'GHSA-xxxx')

      expect(result).toEqual([])
    })

    it('updates stale PRs with BEHIND status', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                author: { login: 'testuser' },
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-xxxx',
                mergeStateStatus: 'BEHIND',
                number: 1,
                state: 'OPEN',
                title: 'Fix GHSA-xxxx',
              },
            ],
          },
        },
      })
      mockProvider.updatePr.mockResolvedValueOnce({})
      mockWriteCache.mockResolvedValueOnce(undefined)

      const result = await cleanupSocketFixPrs('owner', 'repo', 'GHSA-xxxx')

      expect(result).toHaveLength(1)
      expect(mockProvider.updatePr).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
        head: 'socket/fix/GHSA-xxxx',
        base: 'main',
      })
    })

    it('deletes branches for merged PRs', async () => {
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
                state: 'MERGED',
                title: 'Fix GHSA-xxxx',
              },
            ],
          },
        },
      })
      mockProvider.deleteBranch.mockResolvedValueOnce(true)

      const result = await cleanupSocketFixPrs('owner', 'repo', 'GHSA-xxxx')

      expect(result).toHaveLength(1)
      expect(mockProvider.deleteBranch).toHaveBeenCalledWith(
        'socket/fix/GHSA-xxxx',
      )
    })

    it('handles delete branch failure gracefully', async () => {
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
                state: 'MERGED',
                title: 'Fix GHSA-xxxx',
              },
            ],
          },
        },
      })
      mockProvider.deleteBranch.mockRejectedValueOnce(
        new Error('Branch not found'),
      )

      const result = await cleanupSocketFixPrs('owner', 'repo', 'GHSA-xxxx')

      // Should still return the match even if branch deletion fails.
      expect(result).toHaveLength(1)
    })

    it('handles update PR failure gracefully', async () => {
      mockCacheFetch.mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: undefined },
            nodes: [
              {
                author: { login: 'testuser' },
                baseRefName: 'main',
                headRefName: 'socket/fix/GHSA-xxxx',
                mergeStateStatus: 'BEHIND',
                number: 1,
                state: 'OPEN',
                title: 'Fix GHSA-xxxx',
              },
            ],
          },
        },
      })
      mockProvider.updatePr.mockRejectedValueOnce(new Error('Update failed'))

      const result = await cleanupSocketFixPrs('owner', 'repo', 'GHSA-xxxx')

      // Should still return the match even if update fails.
      expect(result).toHaveLength(1)
    })
  })
})
