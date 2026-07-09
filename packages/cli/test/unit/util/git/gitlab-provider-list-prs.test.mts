/**
 * Unit tests for GitLab provider.
 *
 * Purpose: Tests the GitLab merge request provider's listPrs method.
 *
 * Test Coverage: - listPrs pagination - listPrs filtering by state/author -
 * State mapping functions.
 *
 * Related Files: - util/git/gitlab-provider.mts (implementation) -
 * gitlab-provider.test.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @gitbeaker/rest.
const mockCreate = vi.hoisted(() => vi.fn())
const mockRebase = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())
const mockAll = vi.hoisted(() => vi.fn())
const mockNotesCreate = vi.hoisted(() => vi.fn())

vi.mock(import('@gitbeaker/rest'), () => {
  return {
    Gitlab: class MockGitlab {
      MergeRequestNotes = {
        create: mockNotesCreate,
      }
      MergeRequests = {
        all: mockAll,
        create: mockCreate,
        rebase: mockRebase,
        show: mockShow,
      }
    },
  }
})

// Mock debug.
vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

// Set GITLAB_TOKEN env var before importing.
process.env['GITLAB_TOKEN'] = 'test-token'

import { GitLabProvider } from '../../../../src/util/git/gitlab-provider.mts'

describe('git/gitlab-provider', () => {
  let provider: GitLabProvider

  beforeEach(() => {
    vi.clearAllMocks()
    process.env['GITLAB_TOKEN'] = 'test-token'
    provider = new GitLabProvider()
  })

  describe('listPrs', () => {
    it('lists merge requests successfully', async () => {
      mockAll.mockResolvedValueOnce([
        {
          author: { username: 'testuser' },
          iid: 1,
          merge_status: 'can_be_merged',
          source_branch: 'feature-1',
          state: 'opened',
          target_branch: 'main',
          title: 'MR 1',
        },
        {
          author: { username: 'testuser2' },
          iid: 2,
          merge_status: 'cannot_be_merged',
          source_branch: 'feature-2',
          state: 'merged',
          target_branch: 'main',
          title: 'MR 2',
        },
      ])

      const result = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        author: 'testuser',
        baseRefName: 'main',
        headRefName: 'feature-1',
        mergeStateStatus: 'CLEAN',
        number: 1,
        state: 'OPEN',
        title: 'MR 1',
      })
      expect(result[1]).toEqual({
        author: 'testuser2',
        baseRefName: 'main',
        headRefName: 'feature-2',
        mergeStateStatus: 'DIRTY',
        number: 2,
        state: 'MERGED',
        title: 'MR 2',
      })
    })

    it('filters by state', async () => {
      mockAll.mockResolvedValueOnce([])

      await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
        states: 'open',
      })

      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'opened' }),
      )
    })

    it('filters by author', async () => {
      mockAll.mockResolvedValueOnce([])

      await provider.listPrs({
        author: 'testuser',
        owner: 'owner',
        repo: 'repo',
      })

      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ authorUsername: 'testuser' }),
      )
    })

    it('paginates through results', async () => {
      // First page full, second page empty.
      const fullPage = Array(100)
        .fill(undefined)
        .map((_, i) => ({
          author: { username: 'user' },
          iid: i,
          merge_status: 'can_be_merged',
          source_branch: `feature-${i}`,
          state: 'opened',
          target_branch: 'main',
          title: `MR ${i}`,
        }))

      mockAll.mockResolvedValueOnce(fullPage)
      mockAll.mockResolvedValueOnce([])

      const result = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result).toHaveLength(100)
      expect(mockAll).toHaveBeenCalledTimes(2)
    })

    it('stops pagination early when ghsaId match found', async () => {
      mockAll.mockResolvedValueOnce([
        {
          author: { username: 'user' },
          iid: 1,
          merge_status: 'can_be_merged',
          source_branch: 'feature',
          state: 'opened',
          target_branch: 'main',
          title: 'Fix GHSA-xxx',
        },
      ])

      const result = await provider.listPrs({
        ghsaId: 'GHSA-xxx',
        owner: 'owner',
        repo: 'repo',
      })

      expect(result).toHaveLength(1)
      expect(mockAll).toHaveBeenCalledTimes(1)
    })

    it('handles API errors gracefully', async () => {
      mockAll.mockRejectedValueOnce(new Error('API error'))

      const result = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result).toEqual([])
    })

    it('maps merge status unknown correctly', async () => {
      mockAll.mockResolvedValueOnce([
        {
          author: { username: 'user' },
          iid: 1,
          merge_status: 'checking',
          source_branch: 'feature',
          state: 'opened',
          target_branch: 'main',
          title: 'MR 1',
        },
      ])

      const result = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result[0]?.mergeStateStatus).toBe('UNKNOWN')
    })

    it('maps unknown MR state to CLOSED upstream (line 269)', async () => {
      mockAll.mockResolvedValueOnce([
        {
          author: { username: 'user' },
          iid: 1,
          merge_status: 'can_be_merged',
          source_branch: 'feature',
          // Synthetic state value not in {opened, merged} → falls to default.
          state: 'locked',
          target_branch: 'main',
          title: 'MR 1',
        },
      ])

      const result = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result[0]?.state).toBe('CLOSED')
    })

    it('maps merge_status default → UNKNOWN (line 306)', async () => {
      mockAll.mockResolvedValueOnce([
        {
          author: { username: 'user' },
          iid: 1,
          // Synthetic merge_status value not in any known case.
          merge_status: 'totally-unknown-status',
          source_branch: 'feature',
          state: 'opened',
          target_branch: 'main',
          title: 'MR 1',
        },
      ])

      const result = await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
      })

      expect(result[0]?.mergeStateStatus).toBe('UNKNOWN')
    })

    it('filters by merged state (lines 280-281 mapStateToGitLab merged path)', async () => {
      mockAll.mockResolvedValueOnce([])

      await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
        states: 'merged',
      })

      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'merged' }),
      )
    })

    it('filters by closed state (line 283 mapStateToGitLab closed default)', async () => {
      mockAll.mockResolvedValueOnce([])

      await provider.listPrs({
        owner: 'owner',
        repo: 'repo',
        states: 'closed',
      })

      expect(mockAll).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'closed' }),
      )
    })
  })
})
