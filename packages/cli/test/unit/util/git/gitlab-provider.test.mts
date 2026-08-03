/**
 * Unit tests for GitLab provider.
 *
 * Purpose: Tests the GitLab merge request provider implementation.
 *
 * Test Coverage: - GitLabProvider class - createPr method - updatePr method -
 * deleteBranch method - addComment method - getProviderName method -
 * supportsGraphQL method.
 *
 * Related Files: - util/git/gitlab-provider.mts (implementation) -
 * gitlab-provider-list-prs.test.mts.
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
        {
          description: 'Test MR body',
        },
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
        /GitLab API rejected createMergeRequest for owner\/repo .*after 2 attempts/,
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
        /GitLab API rejected createMergeRequest for owner\/repo .*after 3 attempts/,
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
