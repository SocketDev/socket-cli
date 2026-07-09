/**
 * Coverage tests for coana-fix.
 *
 * Purpose: Drives the previously-uncovered branches in coana-fix.mts that the
 * sibling handle-fix-limit.test.mts does not exercise. This file covers the
 * CI-mode per-GHSA PR creation paths: skip/cleanup bookkeeping, superseded-PR
 * closing, stale-branch cleanup, and the missing-token path. The local-mode
 * and CI-discovery paths live in coana-fix.test.mts; the PR-open failure and
 * exception-cleanup paths live in coana-fix-pr-failures.test.mts.
 *
 * Related Files: - src/commands/fix/coana-fix.mts (implementation) -
 * test/unit/commands/fix/handle-fix-limit.test.mts (sibling)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { coanaFix } from '../../../../src/commands/fix/coana-fix.mts'

import type { FixConfig } from '../../../../src/commands/fix/types.mts'

const mockSpawnCoanaDlx = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
const mockGetPackageFilesForScan = vi.hoisted(() => vi.fn())
const mockHandleApiCall = vi.hoisted(() => vi.fn())
const mockGetFixEnv = vi.hoisted(() => vi.fn())
const mockCheckCiEnvVars = vi.hoisted(() =>
  vi.fn(() => ({ missing: [], present: [] })),
)
const mockGetSocketFixPrs = vi.hoisted(() => vi.fn())
const mockCleanupSocketFixPrs = vi.hoisted(() => vi.fn())
const mockOpenSocketFixPr = vi.hoisted(() => vi.fn())
const mockFetchGhsaDetails = vi.hoisted(() => vi.fn())
const mockGitUnstagedModifiedFiles = vi.hoisted(() => vi.fn())
const mockGitCreateBranch = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const mockGitCheckoutBranch = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(true)),
)
const mockGitCommit = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const mockGitPushBranch = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const mockGitRemoteBranchExists = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(false)),
)
const mockGitResetAndClean = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(true)),
)
const mockCleanupStaleBranch = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(true)),
)
const mockCleanupErrorBranches = vi.hoisted(() => vi.fn())
const mockCleanupFailedPrBranches = vi.hoisted(() => vi.fn())
const mockCleanupSuccessfulPrLocalBranch = vi.hoisted(() => vi.fn())
const mockIsGhsaFixed = vi.hoisted(() => vi.fn(() => false))
const mockMarkGhsaFixed = vi.hoisted(() => vi.fn())
const mockEnablePrAutoMerge = vi.hoisted(() => vi.fn())
const mockGetOctokit = vi.hoisted(() =>
  vi.fn(() => ({
    issues: { createComment: vi.fn() },
    pulls: { update: vi.fn() },
  })),
)
const mockSetGitRemoteGithubRepoUrl = vi.hoisted(() => vi.fn())
const mockReadJsonSync = vi.hoisted(() => vi.fn())
const mockSafeDelete = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockLogPrEvent = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/dlx/spawn.mjs'), () => ({
  spawnCoanaDlx: mockSpawnCoanaDlx,
}))

vi.mock(import('../../../../src/util/socket/sdk.mjs'), () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock(
  import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts'),
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)

vi.mock(import('../../../../src/util/fs/path-resolve.mjs'), () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))

vi.mock(import('../../../../src/util/socket/api.mjs'), () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock(import('../../../../src/commands/fix/env-helpers.mts'), () => ({
  checkCiEnvVars: mockCheckCiEnvVars,
  getCiEnvInstructions: vi.fn(() => 'Set CI env vars'),
  getFixEnv: mockGetFixEnv,
}))

vi.mock(import('../../../../src/commands/fix/pull-request.mts'), () => ({
  cleanupSocketFixPrs: mockCleanupSocketFixPrs,
  getSocketFixPrs: mockGetSocketFixPrs,
  openSocketFixPr: mockOpenSocketFixPr,
}))

vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  enablePrAutoMerge: mockEnablePrAutoMerge,
  fetchGhsaDetails: mockFetchGhsaDetails,
  getOctokit: mockGetOctokit,
  setGitRemoteGithubRepoUrl: mockSetGitRemoteGithubRepoUrl,
}))

vi.mock(import('../../../../src/util/git/operations.mjs'), () => ({
  gitCheckoutBranch: mockGitCheckoutBranch,
  gitCommit: mockGitCommit,
  gitCreateBranch: mockGitCreateBranch,
  gitPushBranch: mockGitPushBranch,
  gitRemoteBranchExists: mockGitRemoteBranchExists,
  gitResetAndClean: mockGitResetAndClean,
  gitUnstagedModifiedFiles: mockGitUnstagedModifiedFiles,
}))

vi.mock(import('../../../../src/commands/fix/branch-cleanup.mts'), () => ({
  cleanupErrorBranches: mockCleanupErrorBranches,
  cleanupFailedPrBranches: mockCleanupFailedPrBranches,
  cleanupStaleBranch: mockCleanupStaleBranch,
  cleanupSuccessfulPrLocalBranch: mockCleanupSuccessfulPrLocalBranch,
}))

vi.mock(import('../../../../src/commands/fix/ghsa-tracker.mts'), () => ({
  isGhsaFixed: mockIsGhsaFixed,
  markGhsaFixed: mockMarkGhsaFixed,
}))

vi.mock(import('../../../../src/commands/fix/pr-lifecycle-logger.mts'), () => ({
  logPrEvent: mockLogPrEvent,
}))

vi.mock(import('@socketsecurity/lib-stable/fs/read-json'), () => ({
  readJsonSync: mockReadJsonSync,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mockSafeDelete,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/read-file'), () => ({
  safeReadFileSync: vi.fn(() => undefined),
}))

vi.mock(import('node:fs'), async () => {
  const actual = (await vi.importActual('node:fs')) as Record<
    string,
    unknown
  > & {
    promises: Record<string, unknown>
  }
  return {
    ...actual,
    default: actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
    },
  }
})

const baseConfig: FixConfig = {
  all: false,
  applyFixes: true,
  autopilot: false,
  coanaVersion: undefined,
  cwd: '/test/cwd',
  debug: false,
  disableExternalToolChecks: false,
  disableMajorUpdates: false,
  ecosystems: [],
  exclude: [],
  ghsas: [],
  include: [],
  minSatisfying: false,
  minimumReleaseAge: '',
  orgSlug: 'test-org',
  outputFile: '',
  outputKind: 'text',
  prCheck: true,
  prLimit: 10,
  rangeStyle: 'preserve',
  showAffectedDirectDependencies: false,
  spinner: undefined,
  unknownFlags: [],
} as unknown as FixConfig

const ciFixEnv = {
  baseBranch: 'main',
  gitEmail: 'bot@example.com',
  githubToken: 'gh-token',
  gitUser: 'socket-bot',
  isCi: true,
  repoInfo: { owner: 'org', repo: 'repo' },
}

function setupHappyDefaults() {
  mockSetupSdk.mockResolvedValue({
    ok: true,
    data: { uploadManifestFiles: vi.fn() },
  })
  mockFetchSupportedScanFileNames.mockResolvedValue({
    ok: true,
    data: ['package.json'],
  })
  mockGetPackageFilesForScan.mockResolvedValue(['/test/cwd/package.json'])
  mockHandleApiCall.mockResolvedValue({
    ok: true,
    data: { tarHash: 'hash' },
  })
  mockGetFixEnv.mockResolvedValue({
    githubToken: '',
    gitEmail: '',
    gitUser: '',
    isCi: false,
    repoInfo: undefined,
  })
  mockGitUnstagedModifiedFiles.mockResolvedValue({ ok: true, data: [] })
  mockGetSocketFixPrs.mockResolvedValue([])
  mockFetchGhsaDetails.mockResolvedValue(new Map())
  mockIsGhsaFixed.mockResolvedValue(false)
  mockSafeDelete.mockResolvedValue(undefined)
  mockReadFile.mockResolvedValue('payload')
  mockWriteFile.mockResolvedValue(undefined)
  mockCheckCiEnvVars.mockReturnValue({ missing: [], present: [] })
}

describe('coanaFix (coverage)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupHappyDefaults()
  })

  describe('CI mode per-GHSA PR creation paths', () => {
    beforeEach(() => {
      mockGetFixEnv.mockResolvedValue(ciFixEnv)
      // discovery call returns one id; subsequent calls are fix calls.
      mockSpawnCoanaDlx.mockReset()
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: '["GHSA-AAAA-BBBB-CCCC"]',
      })
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: ['package.json'],
      })
    })

    it('logs skipped count when already-fixed GHSAs are filtered', async () => {
      mockIsGhsaFixed.mockResolvedValueOnce(true) // first ghsa already fixed
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'applied' })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      // No unprocessed ids → loop body never runs.
      expect(result.ok).toBe(true)
    })

    it('logs cleanup PRs debug when cleanupSocketFixPrs returns cleaned items', async () => {
      mockCleanupSocketFixPrs.mockResolvedValueOnce([{ number: 99 }])
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'applied' })
      // gitUnstagedModifiedFiles -> no modified files → continue
      mockGitUnstagedModifiedFiles.mockResolvedValue({ ok: true, data: [] })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupSocketFixPrs).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('continues when cleanupSocketFixPrs throws', async () => {
      mockCleanupSocketFixPrs.mockRejectedValueOnce(new Error('GH down'))
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'applied' })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('continues when per-id spawnCoanaDlx fails', async () => {
      // First fix call (per-id) fails.
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: false,
        message: 'fix failed',
        cause: 'reason',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.fixedAll).toBe(false)
      }
    })

    it('continues when no files were modified after the fix', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockGitUnstagedModifiedFiles.mockResolvedValue({ ok: true, data: [] })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.fixedAll).toBe(false)
      }
    })

    it('continues with empty modified files when gitUnstagedModifiedFiles returns ok:false', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: false,
        message: 'git failed',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('closes superseded PRs before creating a new one', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      // 1st call (counting open PRs at top of CI mode) returns empty.
      // 2nd call (existingPrs for this ghsa) returns [PR#1, PR#2].
      // 3rd call (existingOpenPrs after closing) returns empty.
      mockGetSocketFixPrs
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ number: 1 }, { number: 2 }])
        .mockResolvedValueOnce([])
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: true,
        pr: {
          data: {
            number: 42,
            html_url: 'https://gh.test/pr/42',
          },
        },
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockLogPrEvent).toHaveBeenCalledWith(
        'superseded',
        1,
        'GHSA-AAAA-BBBB-CCCC',
      )
      expect(mockLogPrEvent).toHaveBeenCalledWith(
        'created',
        42,
        'GHSA-AAAA-BBBB-CCCC',
        'https://gh.test/pr/42',
      )
      expect(result.ok).toBe(true)
    })

    it('continues when closing a superseded PR throws', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      // 1st call (counting): [], 2nd call (existing for ghsa): [{7}], 3rd: []
      mockGetSocketFixPrs
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ number: 7 }])
        .mockResolvedValueOnce([])
      const flakyOctokit = {
        issues: {
          createComment: vi.fn().mockRejectedValueOnce(new Error('boom')),
        },
        pulls: { update: vi.fn() },
      }
      mockGetOctokit.mockReturnValueOnce(flakyOctokit)
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: true,
        pr: { data: { number: 50, html_url: 'u' } },
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('skips ghsaId when an open PR already exists', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      // 1st: counting (empty); 2nd: existingPrs (empty so superseded loop
      // skipped); 3rd: existingOpenPrs (one entry → skip with continue).
      mockGetSocketFixPrs
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ number: 88 }])

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('cleans up stale branch and continues when cleanupStaleBranch returns false', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockGetSocketFixPrs.mockResolvedValue([])
      mockGitRemoteBranchExists.mockResolvedValueOnce(true)
      mockCleanupStaleBranch.mockResolvedValueOnce(false)

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupStaleBranch).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('errors and continues when githubToken is missing', async () => {
      mockGetFixEnv.mockResolvedValueOnce({
        ...ciFixEnv,
        githubToken: '',
      })
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })
  })
})
