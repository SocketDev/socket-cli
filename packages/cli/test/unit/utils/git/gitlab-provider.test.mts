/**
 * Unit tests for GitLab provider.
 *
 * Purpose:
 * Tests the GitLab merge request provider implementation.
 *
 * Test Coverage:
 * - GitLabProvider class
 * - createPr method
 * - updatePr method
 * - listPrs method
 * - deleteBranch method
 * - addComment method
 * - getProviderName method
 * - supportsGraphQL method
 * - State mapping functions
 *
 * Related Files:
 * - utils/git/gitlab-provider.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @gitbeaker/rest.
const mockCreate = vi.hoisted(() => vi.fn())
const mockRebase = vi.hoisted(() => vi.fn())
const mockShow = vi.hoisted(() => vi.fn())
const mockAll = vi.hoisted(() => vi.fn())
const mockNotesCreate = vi.hoisted(() => vi.fn())

vi.mock('@gitbeaker/rest', () => {
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
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

// Set GITLAB_TOKEN env var before importing.
process.env['GITLAB_TOKEN'] = 'test-token'

import { GitLabProvider } from '../../../../src/utils/git/gitlab-provider.mts'

describe('git/gitlab-provider', () => {
  let provider: GitLabProvider

  beforeEach(() => {
    vi.clearAllMocks()
    process.env['GITLAB_TOKEN'] = 'test-token'
    provider = new GitLabProvider()
  })

  describe('constructor', () => {
    it('creates provider with default host', () => {
      expect(provider).toBeInstanceOf(GitLabProvider)
    })

    it('throws error when no token available', () => {
      delete process.env['GITLAB_TOKEN']
      expect(() => new GitLabProvider()).toThrow(
        /GitLab access requires a token but process\.env\.GITLAB_TOKEN is not set/,
      )
    })
  })

  describe('getProviderName', () => {
    it('returns gitlab', () => {
      expect(provider.getProviderName()).toBe('gitlab')
    })
  })

  describe('supportsGraphQL', () => {
    it('returns false', () => {
      expect(provider.supportsGraphQL()).toBe(false)
    })
  })

  describe('createPr', () => {
    it('creates merge request successfully', async () => {
      mockCreate.mockResolvedValueOnce({
        iid: 123,
        state: 'opened',
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/123',
      })

      const result = await provider.createPr({
        base: 'main',
        body: 'Test MR body',
        head: 'feature-branch',
        owner: 'owner',
        repo: 'repo',
        title: 'Test MR',
      })

      expect(result).toEqual({
        number: 123,
        state: 'open',
        url: 'https://gitlab.com/owner/repo/-/merge_requests/123',
      })
      expect(mockCreate).toHaveBeenCalledWith(
        'owner/repo',
        'feature-branch',
        'main',
        'Test MR',
        { description: 'Test MR body' },
      )
    })

    it('maps merged state correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        iid: 123,
        state: 'merged',
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/123',
      })

      const result = await provider.createPr({
        base: 'main',
        body: 'Test',
        head: 'feature',
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
      })

      expect(result.state).toBe('merged')
    })

    it('maps closed state correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        iid: 123,
        state: 'closed',
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/123',
      })

      const result = await provider.createPr({
        base: 'main',
        body: 'Test',
        head: 'feature',
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
      })

      expect(result.state).toBe('closed')
    })

    it('retries on failure', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network error'))
      mockCreate.mockResolvedValueOnce({
        iid: 123,
        state: 'opened',
        web_url: 'https://gitlab.com/owner/repo/-/merge_requests/123',
      })

      const result = await provider.createPr({
        base: 'main',
        body: 'Test',
        head: 'feature',
        owner: 'owner',
        repo: 'repo',
        retries: 3,
        title: 'Test',
      })

      expect(result.number).toBe(123)
      expect(mockCreate).toHaveBeenCalledTimes(2)
    })

    it('throws after max retries', async () => {
      mockCreate.mockRejectedValue(new Error('Network error'))

      await expect(
        provider.createPr({
          base: 'main',
          body: 'Test',
          head: 'feature',
          owner: 'owner',
          repo: 'repo',
          retries: 2,
          title: 'Test',
        }),
      ).rejects.toThrow(
        /GitLab API rejected createMergeRequest for owner\/repo .*after 2 retries/,
      )
    })

    it('does not retry on 400 errors', async () => {
      mockCreate.mockRejectedValue({
        cause: { response: { status: 400 } },
        message: 'Validation error',
      })

      await expect(
        provider.createPr({
          base: 'main',
          body: 'Test',
          head: 'feature',
          owner: 'owner',
          repo: 'repo',
          retries: 3,
          title: 'Test',
        }),
      ).rejects.toThrow(
        /GitLab API rejected createMergeRequest for owner\/repo .*after 3 retries/,
      )

      expect(mockCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('updatePr', () => {
    it('rebases merge request successfully', async () => {
      mockRebase.mockResolvedValueOnce({})
      mockShow.mockResolvedValueOnce({ merge_status: 'can_be_merged' })

      await provider.updatePr({
        owner: 'owner',
        prNumber: 123,
        repo: 'repo',
      })

      expect(mockRebase).toHaveBeenCalledWith('owner/repo', 123)
    })

    it('adds conflict comment when rebase results in conflicts', async () => {
      mockRebase.mockResolvedValueOnce({})
      mockShow.mockResolvedValueOnce({ merge_status: 'cannot_be_merged' })
      mockNotesCreate.mockResolvedValueOnce({})

      await provider.updatePr({
        owner: 'owner',
        prNumber: 123,
        repo: 'repo',
      })

      expect(mockNotesCreate).toHaveBeenCalledWith(
        'owner/repo',
        123,
        expect.stringContaining('merge conflicts'),
      )
    })

    it('throws on rebase failure', async () => {
      mockRebase.mockRejectedValueOnce(new Error('Rebase failed'))

      await expect(
        provider.updatePr({
          owner: 'owner',
          prNumber: 123,
          repo: 'repo',
        }),
      ).rejects.toThrow('Failed to update MR !123')
    })
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
        .fill(null)
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
  })

  describe('deleteBranch', () => {
    it('returns false due to interface limitation', async () => {
      const result = await provider.deleteBranch('feature-branch')

      expect(result).toBe(false)
    })
  })

  describe('addComment', () => {
    it('adds comment successfully', async () => {
      mockNotesCreate.mockResolvedValueOnce({})

      await provider.addComment({
        body: 'Test comment',
        owner: 'owner',
        prNumber: 123,
        repo: 'repo',
      })

      expect(mockNotesCreate).toHaveBeenCalledWith(
        'owner/repo',
        123,
        'Test comment',
      )
    })

    it('throws on failure', async () => {
      mockNotesCreate.mockRejectedValueOnce(new Error('API error'))

      await expect(
        provider.addComment({
          body: 'Test',
          owner: 'owner',
          prNumber: 123,
          repo: 'repo',
        }),
      ).rejects.toThrow('Failed to add comment to MR !123')
    })
  })
})
