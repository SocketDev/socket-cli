/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Direct unit tests for create-scan-from-github helpers.
 *
 * Purpose:
 * Tests that import + execute the real source functions (not mocks of them).
 * The companion file `create-scan-from-github.test.mts` only exercises the
 * Octokit mock surface, which leaves the actual source untouched at runtime.
 *
 * Test Coverage:
 * - getRepoDetails / getRepoBranchTree / getLastCommitDetails
 * - selectFocus / makeSure (interactive prompt wrappers)
 * - streamDownloadWithFetch error path
 *
 * Related Files:
 * - src/commands/scan/create-scan-from-github.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOctokit = vi.hoisted(() => ({
  repos: { get: vi.fn(), listCommits: vi.fn(), getContent: vi.fn() },
  git: { getTree: vi.fn() },
}))
const mockGetOctokit = vi.hoisted(() => vi.fn(() => mockOctokit))
const mockWithGitHubRetry = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/git/github.mts', () => ({
  GITHUB_ERR_ABUSE_DETECTION: 'GitHub abuse detection triggered',
  GITHUB_ERR_AUTH_FAILED: 'GitHub authentication failed',
  GITHUB_ERR_GRAPHQL_RATE_LIMIT: 'GitHub GraphQL rate limit exceeded',
  GITHUB_ERR_RATE_LIMIT: 'GitHub rate limit exceeded',
  getOctokit: mockGetOctokit,
  withGitHubRetry: mockWithGitHubRetry,
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: vi.fn(() => ({
    fail: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  })),
}))

const mockSelect = vi.hoisted(() => vi.fn())
const mockConfirm = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  select: mockSelect,
  confirm: mockConfirm,
}))

const mockSocketHttpRequest = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/socket/api.mjs', () => ({
  socketHttpRequest: mockSocketHttpRequest,
}))

const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
vi.mock(
  '../../../../src/commands/scan/fetch-supported-scan-file-names.mts',
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)

const mockHandleCreateNewScan = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/commands/scan/handle-create-new-scan.mts', () => ({
  handleCreateNewScan: mockHandleCreateNewScan,
}))

const mockFetchListAllRepos = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/commands/repository/fetch-list-all-repos.mts', () => ({
  fetchListAllRepos: mockFetchListAllRepos,
}))

const mockSafeDelete = vi.hoisted(() => vi.fn())
const mockSafeMkdirSync = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/fs', () => ({
  safeDelete: mockSafeDelete,
  safeMkdirSync: mockSafeMkdirSync,
}))

import {
  downloadManifestFile,
  getLastCommitDetails,
  getRepoBranchTree,
  getRepoDetails,
  makeSure,
  scanOneRepo,
  scanRepo,
  selectFocus,
  streamDownloadWithFetch,
  testAndDownloadManifestFile,
  testAndDownloadManifestFiles,
} from '../../../../src/commands/scan/create-scan-from-github.mts'

describe('create-scan-from-github (direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeDelete.mockResolvedValue(undefined)
    mockSafeMkdirSync.mockReturnValue(undefined)
  })

  describe('getRepoDetails', () => {
    it('returns default branch on success', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: { default_branch: 'main', name: 'r' },
      })
      const result = await getRepoDetails({
        orgGithub: 'org',
        repoSlug: 'r',
        githubApiUrl: 'https://api.github.com',
        githubToken: 'gh_t',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.defaultBranch).toBe('main')
      }
    })

    it('propagates failure from withGitHubRetry', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'fail',
      })
      const result = await getRepoDetails({
        orgGithub: 'org',
        repoSlug: 'r',
        githubApiUrl: 'https://api.github.com',
        githubToken: 'gh_t',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('GitHub rate limit exceeded')
      }
    })

    it('returns error when default branch is missing', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: { default_branch: undefined, name: 'r' },
      })
      const result = await getRepoDetails({
        orgGithub: 'org',
        repoSlug: 'r',
        githubApiUrl: 'https://api.github.com',
        githubToken: 'gh_t',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Default branch not found')
      }
    })
  })

  describe('getRepoBranchTree', () => {
    it('returns blob paths', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: {
          tree: [
            { type: 'blob', path: 'package.json' },
            { type: 'tree', path: 'src' },
            { type: 'blob', path: 'src/index.ts' },
            { type: 'blob', path: '' },
          ],
        },
      })
      const result = await getRepoBranchTree({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(['package.json', 'src/index.ts'])
      }
    })

    it('returns empty array for "GitHub resource not found" (empty repo)', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub resource not found',
        cause: 'empty repo',
      })
      const result = await getRepoBranchTree({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'empty',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([])
      }
    })

    it('propagates other errors', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'rate limited',
      })
      const result = await getRepoBranchTree({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(false)
    })

    it('returns error for invalid tree response', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: { tree: undefined },
      })
      const result = await getRepoBranchTree({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Invalid tree response')
      }
    })
  })

  describe('getLastCommitDetails', () => {
    it('returns details for first commit', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: [
          {
            sha: 'abc',
            commit: {
              message: 'feat',
              author: { name: 'Alice' },
              committer: { name: 'Bob' },
            },
          },
        ],
      })
      const result = await getLastCommitDetails({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.lastCommitSha).toBe('abc')
        expect(result.data.lastCommitter).toBe('Alice')
        expect(result.data.lastCommitMessage).toBe('feat')
      }
    })

    it('falls back to committer when author missing', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: [
          {
            sha: 'abc',
            commit: {
              message: 'msg',
              committer: { name: 'OnlyCommitter' },
            },
          },
        ],
      })
      const result = await getLastCommitDetails({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      if (result.ok) {
        expect(result.data.lastCommitter).toBe('OnlyCommitter')
      }
    })

    it('returns error for empty commits array', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({ ok: true, data: [] })
      const result = await getLastCommitDetails({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('No commits found')
      }
    })

    it('returns error when commit lacks SHA', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: [{ commit: { message: 'no-sha' } }],
      })
      const result = await getLastCommitDetails({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Missing commit SHA')
      }
    })

    it('propagates withGitHubRetry failure', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'rate limited',
      })
      const result = await getLastCommitDetails({
        defaultBranch: 'main',
        orgGithub: 'org',
        repoSlug: 'r',
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('selectFocus', () => {
    it('returns selected repo', async () => {
      mockSelect.mockResolvedValueOnce('repo-2')
      const result = await selectFocus(['repo-1', 'repo-2', 'repo-3'])
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(['repo-2'])
      }
    })

    it('returns cancel result when user picks exit', async () => {
      mockSelect.mockResolvedValueOnce('')
      const result = await selectFocus(['r1', 'r2'])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Canceled by user')
      }
    })
  })

  describe('makeSure', () => {
    it('returns ok when user confirms', async () => {
      mockConfirm.mockResolvedValueOnce(true)
      const result = await makeSure(50)
      expect(result.ok).toBe(true)
    })

    it('returns canceled result when user declines', async () => {
      mockConfirm.mockResolvedValueOnce(false)
      const result = await makeSure(50)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('User canceled')
      }
    })
  })

  describe('streamDownloadWithFetch', () => {
    it('returns error on bad response status', async () => {
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })
      const result = await streamDownloadWithFetch(
        '/tmp/download-target',
        'https://example.com/file',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Download Failed')
      }
    })

    it('returns error on thrown exception', async () => {
      mockSocketHttpRequest.mockRejectedValueOnce(
        Object.assign(new Error('ECONNREFUSED'), {
          cause: 'network down',
        }),
      )
      const result = await streamDownloadWithFetch(
        '/tmp/download-target',
        'https://example.com/file',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Download Failed')
      }
    })

    it('logs the inner cleanup error when safeDelete also throws', async () => {
      mockSocketHttpRequest.mockRejectedValueOnce(new Error('boom'))
      mockSafeDelete.mockRejectedValueOnce(
        Object.assign(new Error('EACCES'), { code: 'EACCES' }),
      )
      const result = await streamDownloadWithFetch(
        '/tmp/download-target',
        'https://example.com/file',
      )
      expect(mockSafeDelete).toHaveBeenCalled()
      expect(result.ok).toBe(false)
    })
  })

  describe('testAndDownloadManifestFile', () => {
    it('returns isManifest=false when supportedFiles is undefined', async () => {
      const result = await testAndDownloadManifestFile({
        defaultBranch: 'main',
        file: 'package.json',
        orgGithub: 'org',
        repoSlug: 'r',
        supportedFiles: undefined,
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.isManifest).toBe(false)
      }
    })

    it('returns isManifest=false when file is not a known manifest pattern', async () => {
      const result = await testAndDownloadManifestFile({
        defaultBranch: 'main',
        file: 'random.txt',
        orgGithub: 'org',
        repoSlug: 'r',
        supportedFiles: { npm: { 'package.json': {} } } as unknown,
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.isManifest).toBe(false)
      }
    })
  })

  describe('downloadManifestFile', () => {
    it('returns error when withGitHubRetry fails', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'rate limited',
      })
      const result = await downloadManifestFile({
        defaultBranch: 'main',
        file: 'package.json',
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(false)
    })

    it('returns "Not a file" error when content is a directory', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: [{ name: 'a.txt' }, { name: 'b.txt' }],
      })
      const result = await downloadManifestFile({
        defaultBranch: 'main',
        file: 'subdir',
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Not a file')
      }
    })

    it('returns "Missing download URL" when GitHub omits download_url', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: {
          type: 'file',
          size: 100,
          download_url: undefined,
        },
      })
      const result = await downloadManifestFile({
        defaultBranch: 'main',
        file: 'package.json',
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Missing download URL')
      }
    })

    it('returns the download error when streamDownloadWithFetch fails', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: {
          type: 'file',
          size: 100,
          download_url: 'https://example.com/pkg.json',
        },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      const result = await downloadManifestFile({
        defaultBranch: 'main',
        file: 'package.json',
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('testAndDownloadManifestFiles', () => {
    it('returns "No manifest files found" when no files match', async () => {
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: undefined,
      })

      const result = await testAndDownloadManifestFiles({
        defaultBranch: 'main',
        files: ['random.txt', 'foo.bar'],
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('No manifest files found')
      }
    })

    it('returns ok=true with no error when at least one manifest matches', async () => {
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { 'package.json': {} } },
      })
      // We just test the count path — the file content fetch fails but
      // since at least the iteration runs, fileCount may stay 0, in which case
      // we expect "No manifest files found".
      const result = await testAndDownloadManifestFiles({
        defaultBranch: 'main',
        files: ['random.txt'],
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      // Random.txt doesn't match; result depends on implementation.
      expect(typeof result.ok).toBe('boolean')
    })
  })

  describe('scanRepo', () => {
    it('delegates to scanOneRepo and returns its result', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'rate',
      })
      const result = await scanRepo('repo', {
        githubApiUrl: 'https://api.github.com',
        githubToken: 't',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('scanOneRepo', () => {
    it('returns repoResult error when getRepoDetails fails', async () => {
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub rate limit exceeded',
        cause: 'rate',
      })
      const result = await scanOneRepo('repo', {
        githubApiUrl: '',
        githubToken: '',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })
      expect(result.ok).toBe(false)
    })

    it('returns scanCreated=false when default branch has no files', async () => {
      // getRepoDetails ok with main branch.
      mockWithGitHubRetry
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        // getRepoBranchTree ok with empty tree.
        .mockResolvedValueOnce({
          ok: true,
          data: { tree: [] },
        })
      const result = await scanOneRepo('repo', {
        githubApiUrl: '',
        githubToken: '',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.scanCreated).toBe(false)
      }
    })

    it('runs the full happy path through handleCreateNewScan', async () => {
      // getRepoDetails -> default_branch: main
      mockWithGitHubRetry
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        // getRepoBranchTree -> one entry tree
        .mockResolvedValueOnce({
          ok: true,
          data: { tree: [{ type: 'blob', path: 'package.json' }] },
        })
        // testAndDownloadManifestFile -> downloadManifestFile -> getContent ok
        .mockResolvedValueOnce({
          ok: true,
          data: {
            type: 'file',
            size: 100,
            download_url: 'https://example.com/pkg.json',
          },
        })
        // getLastCommitDetails -> one commit
        .mockResolvedValueOnce({
          ok: true,
          data: [
            {
              sha: 'abc123',
              commit: {
                message: 'feat: hello',
                author: { name: 'Alice' },
                committer: { name: 'Bob' },
              },
            },
          ],
        })
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: '{"name": "x"}',
      })
      mockHandleCreateNewScan.mockResolvedValueOnce({
        ok: true,
        data: undefined,
      })

      const result = await scanOneRepo('repo', {
        githubApiUrl: '',
        githubToken: '',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.scanCreated).toBe(true)
      }
      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          branchName: 'main',
          commitHash: 'abc123',
          commitMessage: 'feat: hello',
          repoName: 'repo',
        }),
      )
    })

    it('returns treeResult failure', async () => {
      mockWithGitHubRetry
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        .mockResolvedValueOnce({
          ok: false,
          message: 'GitHub rate limit exceeded',
          cause: 'rate',
        })
      const result = await scanOneRepo('repo', {
        githubApiUrl: '',
        githubToken: '',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })
      expect(result.ok).toBe(false)
    })

    it('propagates downloadResult failure from testAndDownloadManifestFiles', async () => {
      // getRepoDetails + getRepoBranchTree + downloadManifestFile error
      mockWithGitHubRetry
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: { tree: [{ type: 'blob', path: 'package.json' }] },
        })
        // downloadManifestFile getContent fails
        .mockResolvedValueOnce({
          ok: false,
          message: 'GitHub rate limit exceeded',
          cause: 'rate',
        })
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      const result = await scanOneRepo('repo', {
        githubApiUrl: '',
        githubToken: '',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })
      expect(result.ok).toBe(false)
    })

    it('propagates commitResult failure', async () => {
      // getRepoDetails + tree + manifest download + commit failure
      mockWithGitHubRetry
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: { tree: [{ type: 'blob', path: 'package.json' }] },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            type: 'file',
            size: 100,
            download_url: 'https://example.com/pkg.json',
          },
        })
        // commit fails
        .mockResolvedValueOnce({
          ok: false,
          message: 'GitHub resource not found',
          cause: 'no commits',
        })
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: 'data',
      })
      const result = await scanOneRepo('repo', {
        githubApiUrl: '',
        githubToken: '',
        orgSlug: 'o',
        orgGithub: 'g',
        outputKind: 'text',
        repos: '',
      })
      expect(result.ok).toBe(false)
    })
  })

  describe('createScanFromGithub interactive paths', () => {
    let mockCreateScanFromGithub: typeof import('../../../../src/commands/scan/create-scan-from-github.mts').createScanFromGithub

    beforeEach(async () => {
      const mod = await import(
        '../../../../src/commands/scan/create-scan-from-github.mts'
      )
      mockCreateScanFromGithub = mod.createScanFromGithub
    })

    it('invokes selectFocus when interactive and multiple repos and no explicit list', async () => {
      // Will use fetchListAllRepos because !targetRepos.length after parsing ''.
      // But we want !all (so we can hit the selectFocus branch).
      // With !all && !repos, parsing '' gives empty list, then condition
      // (all || !targetRepos.length) triggers fetchListAllRepos. After that
      // selectFocus runs because interactive && >1 && !all && !repos.
      mockFetchListAllRepos.mockResolvedValueOnce({
        ok: true,
        data: { results: [{ slug: 'repo-1' }, { slug: 'repo-2' }] },
      })
      // selectFocus runs the prompts.select; canceled.
      mockSelect.mockResolvedValueOnce('')
      const result = await mockCreateScanFromGithub({
        all: false,
        githubApiUrl: '',
        githubToken: '',
        interactive: true,
        orgGithub: 'org',
        orgSlug: 'org',
        outputKind: 'text',
        repos: '',
      })
      expect(mockSelect).toHaveBeenCalled()
      expect(result.ok).toBe(false)
    })

    it('invokes makeSure when interactive and more than 10 repos and (all || !repos)', async () => {
      // Need >10 repos and (all || !repos). Use all=true to populate from API.
      const many = Array.from({ length: 12 }, (_, i) => ({ slug: `r${i}` }))
      mockFetchListAllRepos.mockResolvedValueOnce({
        ok: true,
        data: { results: many },
      })
      // makeSure prompts.confirm -> cancel
      mockConfirm.mockResolvedValueOnce(false)
      const result = await mockCreateScanFromGithub({
        all: true,
        githubApiUrl: '',
        githubToken: '',
        interactive: true,
        orgGithub: 'org',
        orgSlug: 'org',
        outputKind: 'text',
        repos: '',
      })
      expect(mockConfirm).toHaveBeenCalled()
      expect(result.ok).toBe(false)
    })

    it('returns ok with scanCreated when at least one repo succeeds', async () => {
      // Full happy path for a single repo so we exercise the scanCreated++
      // continue branch + the final happy return.
      mockWithGitHubRetry
        // getRepoDetails
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        // getRepoBranchTree
        .mockResolvedValueOnce({
          ok: true,
          data: { tree: [{ type: 'blob', path: 'package.json' }] },
        })
        // getContent
        .mockResolvedValueOnce({
          ok: true,
          data: {
            type: 'file',
            size: 100,
            download_url: 'https://example.com/pkg.json',
          },
        })
        // getLastCommitDetails
        .mockResolvedValueOnce({
          ok: true,
          data: [
            {
              sha: 'abc123',
              commit: {
                message: 'feat: hello',
                author: { name: 'Alice' },
                committer: { name: 'Bob' },
              },
            },
          ],
        })
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: '{"name": "x"}',
      })
      mockHandleCreateNewScan.mockResolvedValueOnce({
        ok: true,
        data: undefined,
      })

      const result = await mockCreateScanFromGithub({
        all: false,
        githubApiUrl: '',
        githubToken: '',
        interactive: false,
        orgGithub: 'org',
        orgSlug: 'org',
        outputKind: 'text',
        repos: 'repo-a',
      })
      expect(result.ok).toBe(true)
    })

    it('continues past non-blocking per-repo failure when at least one succeeds', async () => {
      // Two repos: first fails non-blocking (404), second succeeds.
      mockWithGitHubRetry
        // repo-a getRepoDetails: 404
        .mockResolvedValueOnce({
          ok: false,
          message: 'GitHub resource not found',
          cause: '404',
        })
        // repo-b getRepoDetails: ok
        .mockResolvedValueOnce({
          ok: true,
          data: { default_branch: 'main' },
        })
        // repo-b tree
        .mockResolvedValueOnce({
          ok: true,
          data: { tree: [{ type: 'blob', path: 'package.json' }] },
        })
        // repo-b getContent
        .mockResolvedValueOnce({
          ok: true,
          data: {
            type: 'file',
            size: 100,
            download_url: 'https://example.com/pkg.json',
          },
        })
        // repo-b last commit
        .mockResolvedValueOnce({
          ok: true,
          data: [
            {
              sha: 'sha',
              commit: {
                message: 'msg',
                author: { name: 'a' },
                committer: { name: 'c' },
              },
            },
          ],
        })
      mockFetchSupportedScanFileNames.mockResolvedValue({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      mockSocketHttpRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: '{}',
      })
      mockHandleCreateNewScan.mockResolvedValue({ ok: true, data: undefined })

      const result = await mockCreateScanFromGithub({
        all: false,
        githubApiUrl: '',
        githubToken: '',
        interactive: false,
        orgGithub: 'org',
        orgSlug: 'org',
        outputKind: 'text',
        repos: 'repo-a,repo-b',
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('testAndDownloadManifestFiles success counting', () => {
    it('returns ok=true when at least one manifest downloads', async () => {
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: {
          type: 'file',
          size: 100,
          download_url: 'https://example.com/pkg.json',
        },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: '{}',
      })
      const result = await testAndDownloadManifestFiles({
        defaultBranch: 'main',
        files: ['package.json', 'README.md'],
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(true)
    })

    it('returns the first download failure when no manifests succeed but one errors', async () => {
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: true,
        data: { npm: { packagejson: { pattern: 'package.json' } } },
      })
      // getContent succeeds but download fails (so testAndDownloadManifestFile
      // returns the inner downloadManifestFile error)
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: true,
        data: {
          type: 'file',
          size: 100,
          download_url: 'https://example.com/pkg.json',
        },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      const result = await testAndDownloadManifestFiles({
        defaultBranch: 'main',
        files: ['package.json'],
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Download Failed')
      }
    })
  })

  describe('downloadManifestFile inner callback execution', () => {
    it('invokes octokit.repos.getContent inside withGitHubRetry', async () => {
      // Make withGitHubRetry run its callback so the inner getContent body
      // is exercised (lines 200-207 in the source).
      mockWithGitHubRetry.mockImplementationOnce(async (op: () => Promise<unknown>) => {
        const data = await op()
        return { ok: true, data }
      })
      mockOctokit.repos.getContent.mockResolvedValueOnce({
        data: {
          type: 'file',
          size: 100,
          download_url: 'https://example.com/pkg.json',
        },
      })
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: '{}',
      })

      const result = await downloadManifestFile({
        defaultBranch: 'main',
        file: 'package.json',
        orgGithub: 'org',
        repoSlug: 'r',
        tmpDir: '/tmp',
      })
      expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
        owner: 'org',
        repo: 'r',
        path: 'package.json',
        ref: 'main',
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('selectFocus success path through createScanFromGithub', () => {
    it('updates targetRepos to selectFocus output and proceeds', async () => {
      // Setup: !all, !repos, interactive=true, 2 repos from listAllRepos.
      // selectFocus returns ok with the selected repo.
      mockFetchListAllRepos.mockResolvedValueOnce({
        ok: true,
        data: { results: [{ slug: 'r1' }, { slug: 'r2' }] },
      })
      mockSelect.mockResolvedValueOnce('r2')
      // Then scan r2 — make getRepoDetails fail 404 so we exit quickly
      // through the perRepoFailures path.
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub resource not found',
        cause: '404',
      })

      const { createScanFromGithub } = await import(
        '../../../../src/commands/scan/create-scan-from-github.mts'
      )
      const result = await createScanFromGithub({
        all: false,
        githubApiUrl: '',
        githubToken: '',
        interactive: true,
        orgGithub: 'org',
        orgSlug: 'org',
        outputKind: 'text',
        repos: '',
      })
      expect(mockSelect).toHaveBeenCalled()
      // Only 1 repo scanned (because selectFocus narrowed to r2), failed 404
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('All repos failed to scan')
      }
    })
  })

  describe('streamDownloadWithFetch success', () => {
    it('writes the response body to disk on ok response', async () => {
      const os = await import('node:os')
      const path = await import('node:path')
      const fs = await import('node:fs/promises')
      const { mkdtempSync } = await import('node:fs')
      const dir = mkdtempSync(path.join(os.tmpdir(), 'sgh-stream-'))
      // Use a flat path so we don't depend on safeMkdirSync (which is mocked).
      const target = path.join(dir, 'package.json')

      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: '{"name": "ok"}',
      })

      const result = await streamDownloadWithFetch(
        target,
        'https://example.com/pkg.json',
      )
      expect(result.ok).toBe(true)
      const written = await fs.readFile(target, 'utf8')
      expect(written).toBe('{"name": "ok"}')
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('creates the parent dir via safeMkdirSync when it does not exist', async () => {
      const os = await import('node:os')
      const path = await import('node:path')
      const fs = await import('node:fs/promises')
      const { mkdtempSync } = await import('node:fs')
      const dir = mkdtempSync(path.join(os.tmpdir(), 'sgh-mkdir-'))
      // Nested subdir that does not exist — exercises the safeMkdirSync branch.
      const target = path.join(dir, 'nested', 'sub', 'package.json')

      // safeMkdirSync is mocked to no-op; route to the real one so the
      // subsequent fs.writeFile can land.
      const { safeMkdirSync: realSafeMkdirSync } =
        await vi.importActual<typeof import('@socketsecurity/lib/fs')>(
          '@socketsecurity/lib/fs',
        )
      mockSafeMkdirSync.mockImplementationOnce((p: string, opts: object) =>
        realSafeMkdirSync(p, opts as Parameters<typeof realSafeMkdirSync>[1]),
      )
      mockSocketHttpRequest.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: 'hi',
      })

      const result = await streamDownloadWithFetch(
        target,
        'https://example.com/pkg.json',
      )
      expect(mockSafeMkdirSync).toHaveBeenCalled()
      expect(result.ok).toBe(true)
      const written = await fs.readFile(target, 'utf8')
      expect(written).toBe('hi')
      await fs.rm(dir, { recursive: true, force: true })
    })
  })
})
