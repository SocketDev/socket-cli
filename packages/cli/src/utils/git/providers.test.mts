import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitHubProvider } from './github-provider.mts'
import { GitLabProvider } from './gitlab-provider.mts'

// Mock dependencies.
const mockCacheDir = path.join(os.tmpdir(), 'socket-cache')
vi.mock('../../constants/paths.mts', () => ({
  SOCKET_CLI_CACHE_DIR: mockCacheDir,
  getGithubCachePath: () => path.join(mockCacheDir, 'github'),
}))

vi.mock('./github.mts', () => ({
  getOctokit: vi.fn(),
  getOctokitGraphql: vi.fn(),
  cacheFetch: vi.fn(),
}))

vi.mock('./operations.mts', () => ({
  gitDeleteRemoteBranch: vi.fn(),
}))

vi.mock('@gitbeaker/rest', () => ({
  Gitlab: vi.fn(function () {
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

describe('provider-factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GITLAB_HOST
    delete process.env.GITLAB_TOKEN
  })

  describe('createPrProvider', () => {
    it('returns GitLabProvider when GITLAB_HOST is set', async () => {
      const providerFactory = await import('./provider-factory.mts')
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
      const providerFactory = await import('./provider-factory.mts')
      vi.spyOn(providerFactory, 'getGitRemoteUrlSync').mockReturnValue('')

      const provider = providerFactory.createPrProvider()
      expect(provider.getProviderName()).toBe('github')
      expect(provider.supportsGraphQL()).toBe(true)
    })

    it('falls back to GitHubProvider for empty remote', async () => {
      const providerFactory = await import('./provider-factory.mts')
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
    vi.clearAllMocks()

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
  })

  describe('createPr', () => {
    it('creates PR successfully', async () => {
      const { getOctokit } = await import('./github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

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

      expect(result).toEqual({
        number: 123,
        url: 'https://github.com/owner/repo/pull/123',
        state: 'open',
      })
    })

    it('handles merged PR state', async () => {
      const { getOctokit } = await import('./github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

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
      const { getOctokit } = await import('./github.mts')
      vi.mocked(getOctokit).mockReturnValue(mockOctokit)

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
      const { cacheFetch, getOctokitGraphql } = await import('./github.mts')
      vi.mocked(getOctokitGraphql).mockReturnValue(mockOctokitGraphql)

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

      vi.mocked(cacheFetch).mockResolvedValue(mockResponse)

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
      const { gitDeleteRemoteBranch } = await import('./operations.mts')
      vi.mocked(gitDeleteRemoteBranch).mockResolvedValue(true)

      const provider = new GitHubProvider()
      const result = await provider.deleteBranch('feature-branch')

      expect(result).toBe(true)
      expect(gitDeleteRemoteBranch).toHaveBeenCalledWith('feature-branch')
    })

    it('handles deletion failure gracefully', async () => {
      const { gitDeleteRemoteBranch } = await import('./operations.mts')
      vi.mocked(gitDeleteRemoteBranch).mockResolvedValue(false)

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
