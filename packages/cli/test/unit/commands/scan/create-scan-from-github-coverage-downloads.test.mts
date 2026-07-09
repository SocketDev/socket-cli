/**
 * Coverage tests for create-scan-from-github download helpers.
 *
 * Purpose: Drives the remaining uncovered branches in
 * create-scan-from-github.mts around manifest download and disk-write
 * handling that the sibling -direct and main test files don't exercise.
 *
 * Why a separate file: The companion -direct file is already at the file-size
 * soft cap; the coverage-only tests would push it past the 1000-line hard cap.
 *
 * Related Files: - src/commands/scan/create-scan-from-github.mts
 * (implementation) -
 * test/unit/commands/scan/create-scan-from-github-direct.test.mts (direct) -
 * test/unit/commands/scan/create-scan-from-github.test.mts (mock-surface) -
 * test/unit/commands/scan/create-scan-from-github-coverage.test.mts
 * (scan-flow coverage)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FsLibType from '@socketsecurity/lib-stable/fs/safe'

const mockOctokit = vi.hoisted(() => ({
  repos: { get: vi.fn(), listCommits: vi.fn(), getContent: vi.fn() },
  git: { getTree: vi.fn() },
}))
const mockGetOctokit = vi.hoisted(() => vi.fn(() => mockOctokit))
const mockWithGitHubRetry = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  GITHUB_ERR_ABUSE_DETECTION: 'GitHub abuse detection triggered',
  GITHUB_ERR_AUTH_FAILED: 'GitHub authentication failed',
  GITHUB_ERR_GRAPHQL_RATE_LIMIT: 'GitHub GraphQL rate limit exceeded',
  GITHUB_ERR_RATE_LIMIT: 'GitHub rate limit exceeded',
  getOctokit: mockGetOctokit,
  withGitHubRetry: mockWithGitHubRetry,
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
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
vi.mock(import('@socketsecurity/lib-stable/stdio/prompts'), () => ({
  select: mockSelect,
  confirm: mockConfirm,
}))

const mockSocketHttpRequest = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/socket/api.mjs'), () => ({
  socketHttpRequest: mockSocketHttpRequest,
}))

const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts'),
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)

const mockHandleCreateNewScan = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/commands/scan/handle-create-new-scan.mts'),
  () => ({
    handleCreateNewScan: mockHandleCreateNewScan,
  }),
)

const mockFetchListAllRepos = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/commands/repository/fetch-list-all-repos.mts'),
  () => ({
    fetchListAllRepos: mockFetchListAllRepos,
  }),
)

const mockSafeDelete = vi.hoisted(() => vi.fn())
const mockSafeMkdirSync = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mockSafeDelete,
  safeMkdirSync: mockSafeMkdirSync,
}))

import {
  downloadManifestFile,
  streamDownloadWithFetch,
} from '../../../../src/commands/scan/create-scan-from-github.mts'
// testAndDownloadManifestFiles (plural) lives in github-scan-manifest.mts and
// is only re-exported singular from create-scan-from-github.mts, so import it
// from its owning module directly.
import { testAndDownloadManifestFiles } from '../../../../src/commands/scan/github-scan-manifest.mts'

describe('create-scan-from-github (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeDelete.mockResolvedValue(undefined)
    mockSafeMkdirSync.mockReturnValue(undefined)
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
        '@socketsecurity/lib-stable/fs/safe',
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
        '@socketsecurity/lib-stable/fs/safe',
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
