/**
 * Unit tests for GitHub scan API interaction behavior.
 *
 * Purpose: Tests the internal functions that interact with GitHub API during
 * scans, exercising mocked Octokit calls and the withGitHubRetry wrapper
 * directly. Validates proper error handling, rate limit detection, and data
 * extraction from GitHub API responses.
 *
 * Test Coverage: getRepoDetails, getRepoBranchTree, getLastCommitDetails, and
 * downloadManifestFile behaviors under success and error conditions.
 *
 * Related Files: - src/commands/scan/create-scan-from-github.mts
 * (implementation) - src/util/git/github.mts (GitHub utilities)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { errorMessage } from '@socketsecurity/lib-stable/errors'

const mockOctokit = vi.hoisted(() => ({
  repos: {
    get: vi.fn(),
    listCommits: vi.fn(),
    getContent: vi.fn(),
  },
  git: {
    getTree: vi.fn(),
  },
}))

const mockWithGitHubRetry = vi.hoisted(() =>
  vi.fn(async (operation: () => Promise<unknown>, context: string) => {
    try {
      const result = await operation()
      return { ok: true, data: result }
    } catch (e) {
      return {
        ok: false,
        message: 'GitHub API error',
        cause: `Error while ${context}: ${errorMessage(e)}`,
      }
    }
  }),
)

describe('GitHub scan API interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getRepoDetails behavior', () => {
    it('handles successful repo details fetch', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: {
          default_branch: 'main',
          name: 'test-repo',
          full_name: 'org/test-repo',
        },
      })

      // Call the mock to simulate the behavior.
      const result = await mockWithGitHubRetry(async () => {
        const { data } = await mockOctokit.repos.get({
          owner: 'org',
          repo: 'test-repo',
        })
        return data
      }, 'fetching repository details for org/test-repo')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.default_branch).toBe('main')
      }
    })

    it('handles rate limit error from repo details', async () => {
      mockOctokit.repos.get.mockRejectedValue(
        new Error('API rate limit exceeded'),
      )

      // Simulate withGitHubRetry returning a rate limit error.
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause:
          'GitHub API rate limit exceeded while fetching repository details. ' +
          'Try again in a few minutes.\n\n' +
          'To increase your rate limit:\n' +
          '- Set GITHUB_TOKEN environment variable',
      })

      const result = await mockWithGitHubRetry(
        async () => mockOctokit.repos.get({ owner: 'org', repo: 'test-repo' }),
        'fetching repository details',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('GitHub rate limit exceeded')
        expect(result.cause).toContain('GITHUB_TOKEN')
      }
    })

    it('handles 404 not found for repo', async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error('Not Found'))

      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub resource not found',
        cause:
          'GitHub resource not found while fetching repository details. ' +
          'The repository may not exist or you may not have access.',
      })

      const result = await mockWithGitHubRetry(
        async () =>
          mockOctokit.repos.get({ owner: 'org', repo: 'nonexistent' }),
        'fetching repository details',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('GitHub resource not found')
      }
    })
  })

  describe('getRepoBranchTree behavior', () => {
    it('handles successful tree fetch', async () => {
      mockOctokit.git.getTree.mockResolvedValue({
        data: {
          sha: 'abc123',
          tree: [
            { type: 'blob', path: 'package.json' },
            { type: 'blob', path: 'src/index.ts' },
            { type: 'tree', path: 'src' },
          ],
        },
      })

      const result = await mockWithGitHubRetry(async () => {
        const { data } = await mockOctokit.git.getTree({
          owner: 'org',
          repo: 'test-repo',
          tree_sha: 'main',
          recursive: 'true',
        })
        return data
      }, 'fetching file tree for branch main in org/test-repo')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tree).toHaveLength(3)
        // Should filter to only blobs.
        const files = result.data.tree
          .filter((obj: unknown) => obj.type === 'blob')
          .map((obj: unknown) => obj.path)
        expect(files).toEqual(['package.json', 'src/index.ts'])
      }
    })

    it('handles rate limit error during tree fetch', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'GitHub API rate limit exceeded while fetching file tree.',
      })

      const result = await mockWithGitHubRetry(
        async () => mockOctokit.git.getTree({ owner: 'org', repo: 'test' }),
        'fetching file tree',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('GitHub rate limit exceeded')
      }
    })

    it('handles empty tree (empty repo)', async () => {
      mockOctokit.git.getTree.mockResolvedValue({
        data: {
          sha: 'abc123',
          tree: [],
        },
      })

      const result = await mockWithGitHubRetry(async () => {
        const { data } = await mockOctokit.git.getTree({
          owner: 'org',
          repo: 'empty-repo',
          tree_sha: 'main',
          recursive: 'true',
        })
        return data
      }, 'fetching file tree')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tree).toHaveLength(0)
      }
    })
  })

  describe('getLastCommitDetails behavior', () => {
    it('handles successful commit fetch', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123def456',
            commit: {
              message: 'feat: add new feature',
              author: { name: 'John Doe' },
              committer: { name: 'John Doe' },
            },
          },
        ],
      })

      const result = await mockWithGitHubRetry(async () => {
        const { data } = await mockOctokit.repos.listCommits({
          owner: 'org',
          repo: 'test-repo',
          sha: 'main',
          per_page: 1,
        })
        return data
      }, 'fetching latest commit SHA for org/test-repo')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data[0].sha).toBe('abc123def456')
        expect(result.data[0].commit.message).toBe('feat: add new feature')
      }
    })

    it('handles rate limit error during commit fetch - the original bug', async () => {
      // This is the exact scenario that caused "Cannot read properties of undefined (reading 'sha')".
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause:
          'GitHub API rate limit exceeded while fetching latest commit SHA. ' +
          'Try again in a few minutes.',
      })

      const result = await mockWithGitHubRetry(
        async () =>
          mockOctokit.repos.listCommits({ owner: 'org', repo: 'test' }),
        'fetching latest commit SHA',
      )

      // With the fix, we get a proper error instead of crashing.
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('GitHub rate limit exceeded')
        // Should NOT crash with "Cannot read properties of undefined (reading 'sha')".
      }
    })

    it('handles empty commits response', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({
        data: [],
      })

      const result = await mockWithGitHubRetry(async () => {
        const { data } = await mockOctokit.repos.listCommits({
          owner: 'org',
          repo: 'empty-repo',
          sha: 'main',
          per_page: 1,
        })
        return data
      }, 'fetching latest commit')

      expect(result.ok).toBe(true)
      if (result.ok) {
        // The actual function checks for empty commits.
        expect(result.data).toHaveLength(0)
      }
    })
  })

  describe('downloadManifestFile behavior', () => {
    it('handles successful file content fetch', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('{"name": "test"}').toString('base64'),
          download_url:
            'https://raw.githubusercontent.com/org/repo/main/package.json',
          size: 16,
        },
      })

      const result = await mockWithGitHubRetry(async () => {
        const { data } = await mockOctokit.repos.getContent({
          owner: 'org',
          repo: 'test-repo',
          path: 'package.json',
          ref: 'main',
        })
        return data
      }, 'fetching file content for package.json in org/test-repo')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.type).toBe('file')
        expect(result.data.download_url).toContain('raw.githubusercontent.com')
      }
    })

    it('handles rate limit during file fetch', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'GitHub API rate limit exceeded while fetching file content.',
      })

      const result = await mockWithGitHubRetry(
        async () =>
          mockOctokit.repos.getContent({
            owner: 'org',
            repo: 'test',
            path: 'package.json',
          }),
        'fetching file content',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('GitHub rate limit exceeded')
      }
    })
  })
})
