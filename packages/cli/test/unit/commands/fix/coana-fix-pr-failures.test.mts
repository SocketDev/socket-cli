/**
 * Coverage tests for coana-fix.
 *
 * Purpose: Drives the previously-uncovered branches in coana-fix.mts that the
 * sibling handle-fix-limit.test.mts does not exercise. This file covers the
 * CI-mode per-GHSA branch-push failures, PR-creation failure reasons, and
 * exception cleanup during the per-id try block. The local-mode and
 * CI-discovery paths live in coana-fix.test.mts; the PR-open and superseded/
 * stale-branch paths live in coana-fix-pr-open.test.mts.
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

    it('cleans up branches and continues when push fails', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockGitPushBranch.mockResolvedValueOnce(false)

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupErrorBranches).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('handles gitRemoteBranchExists throwing inside push-failure cleanup', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockGitPushBranch.mockResolvedValueOnce(false)
      // gitRemoteBranchExists may be called twice: stale-branch check + cleanup
      // (after push failure). Throw on the second call.
      mockGitRemoteBranchExists
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('stat fail'))

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('opens PR successfully and enables autopilot auto-merge', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: true,
        pr: {
          data: { number: 7, html_url: 'https://gh.test/pr/7' },
        },
      })
      mockEnablePrAutoMerge.mockResolvedValueOnce({
        enabled: true,
        details: undefined,
      })

      const result = await coanaFix({
        ...baseConfig,
        autopilot: true,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockEnablePrAutoMerge).toHaveBeenCalled()
      expect(mockMarkGhsaFixed).toHaveBeenCalled()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.fixedAll).toBe(true)
      }
    })

    it('opens PR successfully and logs auto-merge failure', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: true,
        pr: {
          data: { number: 7, html_url: 'https://gh.test/pr/7' },
        },
      })
      mockEnablePrAutoMerge.mockResolvedValueOnce({
        enabled: false,
        details: ['Branch not protected'],
      })

      const result = await coanaFix({
        ...baseConfig,
        autopilot: true,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('logs auto-merge failure with no details (undefined)', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: true,
        pr: { data: { number: 7, html_url: 'u' } },
      })
      mockEnablePrAutoMerge.mockResolvedValueOnce({
        enabled: false,
        details: undefined,
      })

      const result = await coanaFix({
        ...baseConfig,
        autopilot: true,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('handles PR creation failure reason=already_exists', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: false,
        reason: 'already_exists',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('handles PR creation failure reason=validation_error', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: false,
        reason: 'validation_error',
        details: 'bad body',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupFailedPrBranches).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('handles PR creation failure reason=permission_denied', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: false,
        reason: 'permission_denied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupFailedPrBranches).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('handles PR creation failure reason=network_error', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: false,
        reason: 'network_error',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupFailedPrBranches).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('handles PR creation failure with unknown reason and error.message', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockOpenSocketFixPr.mockResolvedValueOnce({
        ok: false,
        reason: 'mystery',
        error: { message: 'mystery error' },
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupFailedPrBranches).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('handles unexpected exception inside the per-id try block', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      // Make getSocketFixPrs throw inside the loop body's try block.
      mockGetSocketFixPrs.mockReset()
      // First call (the one outside the loop counting open PRs) returns empty.
      mockGetSocketFixPrs.mockResolvedValueOnce([])
      // Second call is inside the loop's try — throw to trigger the catch.
      mockGetSocketFixPrs.mockRejectedValueOnce(new Error('inner boom'))

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(mockCleanupErrorBranches).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('handles cleanupErrorBranches throwing during exception cleanup', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: 'applied' })
      mockGetSocketFixPrs.mockReset()
      mockGetSocketFixPrs.mockResolvedValueOnce([])
      mockGetSocketFixPrs.mockRejectedValueOnce(new Error('inner boom'))
      mockCleanupErrorBranches.mockRejectedValueOnce(new Error('cleanup fail'))

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })
  })
})
