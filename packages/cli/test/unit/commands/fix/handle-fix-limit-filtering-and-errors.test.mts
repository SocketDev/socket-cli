/**
 * Unit Tests: Fix Command Handler - Limit Behavior.
 *
 * Purpose: Tests the --limit flag interaction with --id filtering, and the
 * early-return error paths of the fix command handler.
 *
 * Test Coverage: - --id filtering: Verify limit applies to filtered IDs -
 * Early-return error paths for SDK setup, supported-file lookup, and manifest
 * upload failures.
 *
 * Testing Approach: Uses mocks and spies to verify the actual arguments passed
 * to coana CLI, ensuring the business logic correctly applies the limit without
 * making real API calls or creating actual PRs.
 *
 * Related Files: - src/commands/fix/coana-fix.mts - Main fix implementation -
 * src/commands/fix/handle-fix.mts - Fix command handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { coanaFix } from '../../../../src/commands/fix/coana-fix.mts'

import type { FixConfig } from '../../../../src/commands/fix/types.mts'

// Mock all external dependencies.
const mockSpawnCoanaDlx = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
const mockGetPackageFilesForScan = vi.hoisted(() => vi.fn())
const mockHandleApiCall = vi.hoisted(() => vi.fn())
const mockGetFixEnv = vi.hoisted(() => vi.fn())
const mockGetSocketFixPrs = vi.hoisted(() => vi.fn())
const mockFetchGhsaDetails = vi.hoisted(() => vi.fn())
const mockGitUnstagedModifiedFiles = vi.hoisted(() => vi.fn())
const mockReadJsonSync = vi.hoisted(() => vi.fn())
const mockSafeDelete = vi.hoisted(() => vi.fn())

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
  checkCiEnvVars: vi.fn(() => ({ missing: [], present: [] })),
  getCiEnvInstructions: vi.fn(() => 'Set CI env vars'),
  getFixEnv: mockGetFixEnv,
}))

vi.mock(import('../../../../src/commands/fix/pull-request.mts'), () => ({
  cleanupSocketFixPrs: vi.fn(),
  getSocketFixPrs: mockGetSocketFixPrs,
  openSocketFixPr: vi.fn(),
}))

vi.mock(import('../../../../src/util/git/github.mts'), () => ({
  enablePrAutoMerge: vi.fn(),
  fetchGhsaDetails: mockFetchGhsaDetails,
  getOctokit: vi.fn(),
  setGitRemoteGithubRepoUrl: vi.fn(),
}))

vi.mock(import('../../../../src/util/git/operations.mjs'), () => ({
  gitCheckoutBranch: vi.fn(() => Promise.resolve(true)),
  gitCommit: vi.fn(() => Promise.resolve(true)),
  gitCreateBranch: vi.fn(() => Promise.resolve(true)),
  gitPushBranch: vi.fn(() => Promise.resolve(true)),
  gitRemoteBranchExists: vi.fn(() => Promise.resolve(false)),
  gitResetAndClean: vi.fn(() => Promise.resolve(true)),
  gitUnstagedModifiedFiles: mockGitUnstagedModifiedFiles,
}))

vi.mock(import('../../../../src/commands/fix/branch-cleanup.mts'), () => ({
  cleanupErrorBranches: vi.fn(),
  cleanupFailedPrBranches: vi.fn(),
  cleanupStaleBranch: vi.fn(() => Promise.resolve(true)),
  cleanupSuccessfulPrLocalBranch: vi.fn(),
}))

vi.mock(import('../../../../src/commands/fix/ghsa-tracker.mts'), () => ({
  isGhsaFixed: vi.fn(() => false),
  markGhsaFixed: vi.fn(),
}))

vi.mock(import('../../../../src/commands/fix/pr-lifecycle-logger.mts'), () => ({
  logPrEvent: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/fs/read-json'), () => ({
  readJsonSync: mockReadJsonSync,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDelete: mockSafeDelete,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/read-file'), () => ({
  // Return undefined so findSocketYmlSync treats socket.yml as absent.
  safeReadFileSync: vi.fn(() => undefined),
}))

describe('socket fix --limit behavior verification', () => {
  const baseConfig: FixConfig = {
    all: false,
    applyFixes: true,
    autopilot: false,
    coanaVersion: undefined,
    cwd: '/test/cwd',
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
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockSetupSdk.mockResolvedValue({
      ok: true,
      data: {
        uploadManifestFiles: vi.fn(),
      },
    })

    mockFetchSupportedScanFileNames.mockResolvedValue({
      ok: true,
      data: ['package.json', 'package-lock.json'],
    })

    mockGetPackageFilesForScan.mockResolvedValue([
      '/test/cwd/package.json',
      '/test/cwd/package-lock.json',
    ])

    mockHandleApiCall.mockResolvedValue({
      ok: true,
      data: { tarHash: 'test-hash-123' },
    })

    mockGetFixEnv.mockResolvedValue({
      githubToken: '',
      gitUserEmail: '',
      gitUserName: '',
      isCi: false,
      repoInfo: undefined,
    })

    mockGitUnstagedModifiedFiles.mockResolvedValue({
      ok: true,
      data: [],
    })

    mockReadJsonSync.mockReturnValue({ fixed: true })
    mockSafeDelete.mockResolvedValue(undefined)
  })

  describe('--id filtering with --limit', () => {
    it('should apply limit to filtered GHSA IDs', async () => {
      const ghsas = [
        'GHSA-1111-1111-1111',
        'GHSA-2222-2222-2222',
        'GHSA-3333-3333-3333',
        'GHSA-4444-4444-4444',
        'GHSA-5555-5555-5555',
      ]

      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
        prLimit: 2,
      })

      expect(result.ok).toBe(true)

      // Should only process first 2 GHSAs.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      const applyFixesIndex = callArgs.indexOf('--apply-fixes-to')
      const ghsaArgs = callArgs
        .slice(applyFixesIndex + 1)
        .filter(arg => arg.startsWith('GHSA-'))

      expect(ghsaArgs).toHaveLength(2)
      expect(ghsaArgs).toEqual(['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222'])
    })

    it('should handle limit 1 with single GHSA ID', async () => {
      const ghsas = ['GHSA-1111-1111-1111']

      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
        prLimit: 1,
      })

      expect(result.ok).toBe(true)
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)

      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      const applyFixesIndex = callArgs.indexOf('--apply-fixes-to')
      const ghsaArgs = callArgs
        .slice(applyFixesIndex + 1)
        .filter(arg => arg.startsWith('GHSA-'))

      expect(ghsaArgs).toEqual(['GHSA-1111-1111-1111'])
    })
  })

  describe('early-return error paths', () => {
    it('returns SDK setup error when setupSdk fails (line 110)', async () => {
      mockSetupSdk.mockResolvedValueOnce({
        ok: false,
        message: 'Auth Error',
        cause: 'Invalid token',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Auth Error')
      }
      // spawnCoanaDlx should never run when SDK setup fails.
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })

    it('returns supported-files error when fetch fails (line 117)', async () => {
      mockFetchSupportedScanFileNames.mockResolvedValueOnce({
        ok: false,
        message: 'API Error',
        cause: 'Network timeout',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('API Error')
      }
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })

    it('returns upload error when manifest upload fails (line 150)', async () => {
      mockHandleApiCall.mockResolvedValueOnce({
        ok: false,
        message: 'Upload Failed',
        cause: 'Bad gateway',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Upload Failed')
      }
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })

    it('returns error when upload returns no tar hash (lines 154-160)', async () => {
      mockHandleApiCall.mockResolvedValueOnce({
        ok: true,
        // No tarHash in payload — server contract violation.
        data: {},
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('tar hash')
      }
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })
  })
})
