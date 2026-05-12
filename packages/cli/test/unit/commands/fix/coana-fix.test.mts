/* max-file-lines: legitimate — coverage-targeted tests for one command/module; splitting would fragment closely related assertions. */
/**
 * Coverage tests for coana-fix.
 *
 * Purpose:
 * Drives the previously-uncovered branches in coana-fix.mts that the
 * sibling handle-fix-limit.test.mts does not exercise. The limit tests
 * cover the happy local-mode path and the early-error returns; this
 * file covers the PR-creation, branch-cleanup, outputFile, discovery
 * parse-error, and per-GHSA failure branches.
 *
 * Related Files:
 * - src/commands/fix/coana-fix.mts (implementation)
 * - test/unit/commands/fix/handle-fix-limit.test.mts (sibling)
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

vi.mock('../../../../src/utils/dlx/spawn.mjs', () => ({
  spawnCoanaDlx: mockSpawnCoanaDlx,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock(
  '../../../../src/commands/scan/fetch-supported-scan-file-names.mts',
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)

vi.mock('../../../../src/utils/fs/path-resolve.mjs', () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))

vi.mock('../../../../src/utils/socket/api.mjs', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('../../../../src/commands/fix/env-helpers.mts', () => ({
  checkCiEnvVars: mockCheckCiEnvVars,
  getCiEnvInstructions: vi.fn(() => 'Set CI env vars'),
  getFixEnv: mockGetFixEnv,
}))

vi.mock('../../../../src/commands/fix/pull-request.mts', () => ({
  cleanupSocketFixPrs: mockCleanupSocketFixPrs,
  getSocketFixPrs: mockGetSocketFixPrs,
  openSocketFixPr: mockOpenSocketFixPr,
}))

vi.mock('../../../../src/utils/git/github.mts', () => ({
  enablePrAutoMerge: mockEnablePrAutoMerge,
  fetchGhsaDetails: mockFetchGhsaDetails,
  getOctokit: mockGetOctokit,
  setGitRemoteGithubRepoUrl: mockSetGitRemoteGithubRepoUrl,
}))

vi.mock('../../../../src/utils/git/operations.mjs', () => ({
  gitCheckoutBranch: mockGitCheckoutBranch,
  gitCommit: mockGitCommit,
  gitCreateBranch: mockGitCreateBranch,
  gitPushBranch: mockGitPushBranch,
  gitRemoteBranchExists: mockGitRemoteBranchExists,
  gitResetAndClean: mockGitResetAndClean,
  gitUnstagedModifiedFiles: mockGitUnstagedModifiedFiles,
}))

vi.mock('../../../../src/commands/fix/branch-cleanup.mts', () => ({
  cleanupErrorBranches: mockCleanupErrorBranches,
  cleanupFailedPrBranches: mockCleanupFailedPrBranches,
  cleanupStaleBranch: mockCleanupStaleBranch,
  cleanupSuccessfulPrLocalBranch: mockCleanupSuccessfulPrLocalBranch,
}))

vi.mock('../../../../src/commands/fix/ghsa-tracker.mts', () => ({
  isGhsaFixed: mockIsGhsaFixed,
  markGhsaFixed: mockMarkGhsaFixed,
}))

vi.mock('../../../../src/commands/fix/pr-lifecycle-logger.mts', () => ({
  logPrEvent: mockLogPrEvent,
}))

vi.mock('@socketsecurity/lib/fs', () => ({
  readJsonSync: mockReadJsonSync,
  safeDelete: mockSafeDelete,
  safeReadFileSync: vi.fn(() => undefined),
}))

vi.mock('node:fs', async () => {
  const actual = (await vi.importActual('node:fs')) as Record<
    string,
    unknown
  > & { promises: Record<string, unknown> }
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
  gitUser: 'socket-bot',
  githubToken: 'gh-token',
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
