/**
 * Coverage tests for coana-fix.
 *
 * Purpose: Drives the previously-uncovered branches in coana-fix.mts that the
 * sibling handle-fix-limit.test.mts does not exercise. The limit tests cover
 * the happy local-mode path and the early-error returns; this file covers the
 * local-mode info-message paths and the CI-mode discovery branches (parse
 * errors, empty output, thrown errors). The CI-mode per-GHSA PR creation and
 * cleanup paths live in coana-fix-pr-open.test.mts and
 * coana-fix-pr-failures.test.mts.
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

  describe('local mode info messages', () => {
    it('logs the partial-missing CI env info when some present and some missing', async () => {
      mockCheckCiEnvVars.mockReturnValue({
        missing: ['SOCKET_CLI_GITHUB_TOKEN'],
        present: ['GITHUB_REPOSITORY'],
      })
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'fix applied' })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })
      expect(result.ok).toBe(true)
    })

    it('writes the local-mode output file when outputFile is provided', async () => {
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'fix applied' })
      mockReadFile.mockResolvedValueOnce('{"fixed": true}')

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
        outputFile: '/tmp/out.json',
      })

      expect(mockReadFile).toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/out.json',
        '{"fixed": true}',
        'utf8',
      )
      expect(result.ok).toBe(true)
    })

    it('returns the spawnCoanaDlx error in local mode', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: false,
        message: 'coana failed',
        cause: 'no coana available',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('coana failed')
      }
    })

    it('returns empty result when prLimit is 0 in local mode', async () => {
      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
        prLimit: 0,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.fixedAll).toBe(false)
        expect(result.data.ghsaDetails).toEqual([])
      }
    })
  })

  describe('CI mode discovery', () => {
    beforeEach(() => {
      mockGetFixEnv.mockResolvedValue(ciFixEnv)
    })

    it('uses getSocketFixPrs catch path when counting open PRs throws', async () => {
      // First getSocketFixPrs throws.
      mockGetSocketFixPrs.mockRejectedValueOnce(new Error('GH down'))
      // For the discovery later (shouldSpawnCoana && discover) — return ids.
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: '["GHSA-AAAA-BBBB-CCCC"]',
      })
      // For subsequent fix per id.
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'applied' })
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: [],
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 3,
      })
      expect(result.ok).toBe(true)
    })

    it('handles non-array JSON from find-vulnerabilities (throws inside try)', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: '{"not": "an array"}',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 2,
      })
      // No ids discovered → returns ok with empty results.
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ghsaDetails).toEqual([])
      }
    })

    it('handles invalid JSON from find-vulnerabilities (parse error)', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: 'not json at all',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 2,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ghsaDetails).toEqual([])
      }
    })

    it('handles empty output from find-vulnerabilities', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: '',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 2,
      })
      expect(result.ok).toBe(true)
    })

    it('handles spawnCoanaDlx throwing during discovery', async () => {
      mockSpawnCoanaDlx.mockRejectedValueOnce(new Error('boom'))

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 2,
      })
      expect(result.ok).toBe(true)
    })

    it('slices explicit ghsa list when shouldSpawnCoana and not discovering', async () => {
      // CI mode + explicit ghsas (not 'all') → goes through the
      // `else if (shouldSpawnCoana)` branch (line 351).
      // The fix call runs once per id (no discovery first).
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'applied' })
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: [],
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222'],
        prLimit: 1,
      })
      expect(result.ok).toBe(true)
    })

    it('skips processing when discovery returns ok:false', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: false,
        message: 'discovery failed',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['all'],
        prLimit: 2,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ghsaDetails).toEqual([])
      }
    })

    it('returns empty result when repoInfo is undefined in CI mode-like config', async () => {
      // Force repoInfo undefined but isCi false; shouldOpenPrs = false.
      mockGetFixEnv.mockResolvedValueOnce({
        ...ciFixEnv,
        repoInfo: undefined,
      })
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: 'applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })
      // Falls through to local mode (shouldOpenPrs=false).
      expect(result.ok).toBe(true)
    })
  })
})
