/* max-file-lines: legitimate — coverage-targeted tests for one command/module; splitting would fragment closely related assertions. */
/**
 * Coverage tests for create-scan-from-github helpers.
 *
 * Purpose:
 * Drives the remaining uncovered branches in create-scan-from-github.mts
 * that the sibling -direct and main test files don't exercise.
 *
 * Why a separate file:
 * The companion -direct file is already at the file-size soft cap; the
 * coverage-only tests would push it past the 1000-line hard cap.
 *
 * Related Files:
 * - src/commands/scan/create-scan-from-github.mts (implementation)
 * - test/unit/commands/scan/create-scan-from-github-direct.test.mts (direct)
 * - test/unit/commands/scan/create-scan-from-github.test.mts (mock-surface)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FsLibType from '@socketsecurity/lib-stable/fs'
import type * as CreateScanFromGithub from '../../../../src/commands/scan/create-scan-from-github.mts'

const mockOctokit = vi.hoisted(() => ({
  repos: { get: vi.fn(), listCommits: vi.fn(), getContent: vi.fn() },
  git: { getTree: vi.fn() },
}))
const mockGetOctokit = vi.hoisted(() => vi.fn(() => mockOctokit))
const mockWithGitHubRetry = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/util/git/github.mts', () => ({
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
vi.mock('../../../../src/util/socket/api.mjs', () => ({
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
  scanOneRepo,
  streamDownloadWithFetch,
  testAndDownloadManifestFiles,
} from '../../../../src/commands/scan/create-scan-from-github.mts'

describe('create-scan-from-github (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeDelete.mockResolvedValue(undefined)
    mockSafeMkdirSync.mockReturnValue(undefined)
  })

  describe('scanOneRepo', () => {
    it('runs the full happy path through handleCreateNewScan', async () => {
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
    let mockCreateScanFromGithub: typeof CreateScanFromGithub.createScanFromGithub

    beforeEach(async () => {
      const mod = await import(
        '../../../../src/commands/scan/create-scan-from-github.mts'
      )
      mockCreateScanFromGithub = mod.createScanFromGithub
    })

    it('invokes selectFocus when interactive and multiple repos and no explicit list', async () => {
      mockFetchListAllRepos.mockResolvedValueOnce({
        ok: true,
        data: { results: [{ slug: 'repo-1' }, { slug: 'repo-2' }] },
      })
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
      const many = Array.from({ length: 12 }, (_, i) => ({ slug: `r${i}` }))
      mockFetchListAllRepos.mockResolvedValueOnce({
        ok: true,
        data: { results: many },
      })
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
      mockWithGitHubRetry
        .mockResolvedValueOnce({
          ok: false,
          message: 'GitHub resource not found',
          cause: '404',
        })
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

    it('updates targetRepos to selectFocus output and proceeds', async () => {
      mockFetchListAllRepos.mockResolvedValueOnce({
        ok: true,
        data: { results: [{ slug: 'r1' }, { slug: 'r2' }] },
      })
      mockSelect.mockResolvedValueOnce('r2')
      mockWithGitHubRetry.mockResolvedValueOnce({
        ok: false,
        message: 'GitHub resource not found',
        cause: '404',
      })

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
      if (!result.ok) {
        expect(result.message).toBe('All repos failed to scan')
      }
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
      mockWithGitHubRetry.mockImplementationOnce(
        async (op: () => Promise<unknown>) => {
          const data = await op()
          return { ok: true, data }
        },
      )
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

  describe('streamDownloadWithFetch inner cleanup error', () => {
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
      // mockSafeDelete is the mocked safeDelete here; reach for the real
      // one via importActual to actually remove the tmpdir.
      const actualFs = await vi.importActual<typeof FsLibType>(
        '@socketsecurity/lib/fs',
      )
      await actualFs.safeDelete(dir, { force: true, recursive: true })
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
      const actualFs = await vi.importActual<typeof FsLibType>(
        '@socketsecurity/lib/fs',
      )
      mockSafeMkdirSync.mockImplementationOnce((p: string, opts: object) =>
        actualFs.safeMkdirSync(
          p,
          opts as Parameters<typeof actualFs.safeMkdirSync>[1],
        ),
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
      await actualFs.safeDelete(dir, { force: true, recursive: true })
    })
  })
})
