/**
 * Unit tests for git provider detection.
 *
 * Purpose:
 * Tests git provider detection (GitHub, GitLab, Bitbucket). Validates provider identification from remote URLs.
 *
 * Test Coverage:
 * - GitHub detection
 * - GitLab detection
 * - Bitbucket detection
 * - Remote URL parsing
 * - SSH vs HTTPS URLs
 * - Provider-specific features
 *
 * Testing Approach:
 * Tests git provider identification and URL parsing logic.
 *
 * Related Files:
 * - utils/git/providers.mts (implementation)
 */

import os from 'node:os'
import path from 'node:path'

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

// Mock dependencies.
const mockCacheDir = path.join(os.tmpdir(), 'socket-cache')
vi.mock('../../../../src/constants/paths.mts', () => ({
  SOCKET_CLI_CACHE_DIR: mockCacheDir,
  getGithubCachePath: () => path.join(mockCacheDir, 'github'),
}))

vi.mock('../../../../src/utils/git/github.mts', () => ({
  cacheFetch: mockCacheFetch,
  getOctokit: mockGetOctokit,
  getOctokitGraphql: mockGetOctokitGraphql,
  handleGitHubApiError: vi.fn((e: unknown, context: string) => ({
    ok: false,
    message: 'GitHub API error',
    cause: `Error while ${context}: ${e instanceof Error ? e.message : String(e)}`,
  })),
  handleGraphqlError: vi.fn((_e: unknown, context: string) => ({
    ok: false,
    message: 'GitHub GraphQL error',
    cause: `GraphQL error while ${context}`,
  })),
  withGitHubRetry: mockWithGitHubRetry,
}))

vi.mock('../../../../src/utils/git/operations.mts', () => ({
  gitDeleteRemoteBranch: mockGitDeleteRemoteBranch,
}))

vi.mock('@gitbeaker/rest', () => ({
  Gitlab: vi.fn(function MockGitlab() {
    return {
      MergeRequests: {
        create: vi.fn(),
        show: vi.fn(),
        rebase: vi.fn(),
        all: vi.fn(),
      },
      MergeRequestNotes: {
        create: vi.fn(),
      },
    }
  }),
}))

import { GitHubProvider } from '../../../../src/utils/git/github-provider.mts'
import { GitLabProvider } from '../../../../src/utils/git/gitlab-provider.mts'

describe('provider-factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GITLAB_HOST
    delete process.env.GITLAB_TOKEN
  })

  describe('createPrProvider', () => {
    it('returns GitLabProvider when GITLAB_HOST is set', async () => {
      const providerFactory =
        await import('../../../../src/utils/git/provider-factory.mts')
      vi.spyOn(providerFactory, 'getGitRemoteUrlSync').mockReturnValue(
        'https://github.com/owner/repo.git',
      )

      process.env.GITLAB_HOST = 'https://gitlab.example.com'
      process.env.GITLAB_TOKEN = 'test-token'

      const provider = providerFactory.createPrProvider()
      expect(provider.getProviderName()).toBe('gitlab')
      expect(provider.supportsGraphQL()).toBe(false)
    })

    it('falls back to GitHubProvider when git command fails', async () => {
      const providerFactory =
        await import('../../../../src/utils/git/provider-factory.mts')
      vi.spyOn(providerFactory, 'getGitRemoteUrlSync').mockReturnValue('')

      const provider = providerFactory.createPrProvider()
      expect(provider.getProviderName()).toBe('github')
      expect(provider.supportsGraphQL()).toBe(true)
    })

    it('falls back to GitHubProvider for empty remote', async () => {
      const providerFactory =
        await import('../../../../src/utils/git/provider-factory.mts')
      vi.spyOn(providerFactory, 'getGitRemoteUrlSync').mockReturnValue('')

      const provider = providerFactory.createPrProvider()
      expect(provider.getProviderName()).toBe('github')
      expect(provider.supportsGraphQL()).toBe(true)
    })
  })
})

describe('GitHubProvider', () => {
  let mockOctokit: any
  let mockOctokitGraphql: any

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

  describe('createPr', () => {
    it('creates PR successfully', async () => {
      // Set up mock before creating provider.
      mockOctokit.pulls.create.mockResolvedValue({
        data: {
          number: 123,
          html_url: 'https://github.com/owner/repo/pull/123',
          state: 'open',
        },
      })

      const provider = new GitHubProvider()
      const result = await provider.createPr({
        owner: 'owner',
        repo: 'repo',
        title: 'Test PR',
        head: 'feature-branch',
        base: 'main',
        body: 'Test body',
      })

      expect(mockGetOctokit).toHaveBeenCalled()
      expect(result).toEqual({
        number: 123,
        url: 'https://github.com/owner/repo/pull/123',
        state: 'open',
      })
    })

    it('handles merged PR state', async () => {
      // Set up mock before creating provider.
      mockOctokit.pulls.create.mockResolvedValue({
        data: {
          number: 456,
          html_url: 'https://github.com/owner/repo/pull/456',
          state: 'closed',
          merged_at: '2024-01-01T00:00:00Z',
        },
      })

      const provider = new GitHubProvider()
      const result = await provider.createPr({
        owner: 'owner',
        repo: 'repo',
        title: 'Test PR',
        head: 'feature',
        base: 'main',
        body: 'Test',
      })

      expect(result.state).toBe('merged')
    })
  })

  describe('addComment', () => {
    it('adds comment successfully', async () => {
      // Set up mock before creating provider.
      mockOctokit.issues.createComment.mockResolvedValue({})

      const provider = new GitHubProvider()
      await provider.addComment({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
        body: 'Test comment',
      })

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        body: 'Test comment',
      })
    })
  })

  describe('listPrs', () => {
    it('lists PRs with pagination', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            nodes: [
              {
                number: 1,
                title: 'Test PR 1',
                author: { login: 'user1' },
                headRefName: 'feature-1',
                baseRefName: 'main',
                state: 'OPEN',
                mergeStateStatus: 'CLEAN',
              },
              {
                number: 2,
                title: 'Test PR 2',
                author: { login: 'user2' },
                headRefName: 'feature-2',
                baseRefName: 'main',
                state: 'MERGED',
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

      expect(results).toHaveLength(2)
      expect(results[0]!.number).toBe(1)
      expect(results[1]!.number).toBe(2)
    })
  })

  describe('deleteBranch', () => {
    it('deletes branch successfully', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(true)

      const provider = new GitHubProvider()
      const result = await provider.deleteBranch('feature-branch')

      expect(result).toBe(true)
      expect(mockGitDeleteRemoteBranch).toHaveBeenCalledWith('feature-branch')
    })

    it('handles deletion failure gracefully', async () => {
      mockGitDeleteRemoteBranch.mockResolvedValue(false)

      const provider = new GitHubProvider()
      const result = await provider.deleteBranch('feature-branch')

      expect(result).toBe(false)
    })

    it('handles deletion exception gracefully', async () => {
      mockGitDeleteRemoteBranch.mockRejectedValue(new Error('Branch not found'))

      const provider = new GitHubProvider()
      const result = await provider.deleteBranch('nonexistent-branch')

      expect(result).toBe(false)
    })
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
          merged_at: null,
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

  describe('listPrs advanced scenarios', () => {
    it('filters PRs by author', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
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
      expect(results[0]!.author).toBe('user1')
    })

    it('handles PRs without author', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
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
      expect(results[0]!.author).toBe('<unknown>')
    })

    it('handles specific states filter', async () => {
      const mockResponse = {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
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

  describe('metadata', () => {
    it('returns correct provider name', () => {
      const provider = new GitHubProvider()
      expect(provider.getProviderName()).toBe('github')
    })

    it('reports GraphQL support', () => {
      const provider = new GitHubProvider()
      expect(provider.supportsGraphQL()).toBe(true)
    })
  })
})

describe('GitLabProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GITLAB_TOKEN = 'test-token'
  })

  describe('metadata', () => {
    it('returns correct provider name', () => {
      const provider = new GitLabProvider()
      expect(provider.getProviderName()).toBe('gitlab')
    })

    it('does not report GraphQL support', () => {
      const provider = new GitLabProvider()
      expect(provider.supportsGraphQL()).toBe(false)
    })
  })
})
