import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetOctokit = vi.hoisted(() => vi.fn())
const mockGetOctokitGraphql = vi.hoisted(() => vi.fn())
const mockCacheFetch = vi.hoisted(() => vi.fn())
const mockGitDeleteRemoteBranch = vi.hoisted(() => vi.fn())

// Mock dependencies.
const mockCacheDir = path.join(os.tmpdir(), 'socket-cache')
vi.mock('../../../../src/constants/paths.mts', () => ({
  SOCKET_CLI_CACHE_DIR: mockCacheDir,
  getGithubCachePath: () => path.join(mockCacheDir, 'github'),
}))

vi.mock('../../../../src/utils/git/github.mts', () => ({
  getOctokit: mockGetOctokit,
  getOctokitGraphql: mockGetOctokitGraphql,
  cacheFetch: mockCacheFetch,
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
      const providerFactory = await import(
        '../../../../src/utils/git/provider-factory.mts'
      )
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
      const providerFactory = await import(
        '../../../../src/utils/git/provider-factory.mts'
      )
      vi.spyOn(providerFactory, 'getGitRemoteUrlSync').mockReturnValue('')

      const provider = providerFactory.createPrProvider()
      expect(provider.getProviderName()).toBe('github')
      expect(provider.supportsGraphQL()).toBe(true)
    })

    it('falls back to GitHubProvider for empty remote', async () => {
      const providerFactory = await import(
        '../../../../src/utils/git/provider-factory.mts'
      )
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
