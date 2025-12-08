import { beforeEach, describe, expect, it, vi } from 'vitest'

import { coanaFix } from './coana-fix.mts'

import type { FixConfig } from './types.mts'

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

vi.mock('../../utils/dlx.mts', () => ({
  spawnCoanaDlx: mockSpawnCoanaDlx,
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('../scan/fetch-supported-scan-file-names.mts', () => ({
  fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
}))

vi.mock('../../utils/path-resolve.mts', () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))

vi.mock('../../utils/api.mts', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('./env-helpers.mts', () => ({
  checkCiEnvVars: vi.fn(() => ({ missing: [], present: [] })),
  getCiEnvInstructions: vi.fn(() => 'Set CI env vars'),
  getFixEnv: mockGetFixEnv,
}))

vi.mock('./pull-request.mts', () => ({
  getSocketFixPrs: mockGetSocketFixPrs,
  openSocketFixPr: vi.fn(),
}))

vi.mock('../../utils/github.mts', () => ({
  enablePrAutoMerge: vi.fn(),
  fetchGhsaDetails: mockFetchGhsaDetails,
  setGitRemoteGithubRepoUrl: vi.fn(),
}))

vi.mock('../../utils/git.mts', () => ({
  gitCheckoutBranch: vi.fn(() => Promise.resolve(true)),
  gitCommit: vi.fn(() => Promise.resolve(true)),
  gitCreateBranch: vi.fn(() => Promise.resolve(true)),
  gitDeleteBranch: vi.fn(() => Promise.resolve(true)),
  gitPushBranch: vi.fn(() => Promise.resolve(true)),
  gitRemoteBranchExists: vi.fn(() => Promise.resolve(false)),
  gitResetAndClean: vi.fn(() => Promise.resolve(true)),
  gitUnstagedModifiedFiles: mockGitUnstagedModifiedFiles,
}))

vi.mock('./branch-cleanup.mts', () => ({
  cleanupErrorBranches: vi.fn(),
  cleanupFailedPrBranches: vi.fn(),
  cleanupStaleBranch: vi.fn(() => Promise.resolve(true)),
  cleanupSuccessfulPrLocalBranch: vi.fn(),
}))

describe('socket fix --pr-limit behavior verification', () => {
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
      repoInfo: null,
    })

    mockGitUnstagedModifiedFiles.mockResolvedValue({
      ok: true,
      data: [],
    })
  })

  describe('local mode (no PRs)', () => {
    it('should process all GHSAs in local mode (no limit)', async () => {
      const ghsas = [
        'GHSA-1111-1111-1111',
        'GHSA-2222-2222-2222',
        'GHSA-3333-3333-3333',
        'GHSA-4444-4444-4444',
        'GHSA-5555-5555-5555',
      ]

      // Mock successful fix result.
      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
        prLimit: 3, // prLimit should have no effect in local mode.
      })

      expect(result.ok).toBe(true)

      // Verify spawnCoanaDlx was called once with all GHSAs (local mode has no limit).
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(callArgs).toContain('--apply-fixes-to')

      // Find the index of --apply-fixes-to and check the next arguments.
      const applyFixesIndex = callArgs.indexOf('--apply-fixes-to')
      const ghsaArgs = callArgs
        .slice(applyFixesIndex + 1)
        .filter(arg => arg.startsWith('GHSA-'))

      // All 5 GHSAs should be processed in local mode.
      expect(ghsaArgs).toEqual([
        'GHSA-1111-1111-1111',
        'GHSA-2222-2222-2222',
        'GHSA-3333-3333-3333',
        'GHSA-4444-4444-4444',
        'GHSA-5555-5555-5555',
      ])
    })

    it('should process all provided GHSAs in local mode', async () => {
      const ghsas = ['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222']

      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
      })

      expect(result.ok).toBe(true)
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)

      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      const applyFixesIndex = callArgs.indexOf('--apply-fixes-to')
      const ghsaArgs = callArgs
        .slice(applyFixesIndex + 1)
        .filter(arg => arg.startsWith('GHSA-'))

      expect(ghsaArgs).toEqual(['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222'])
    })

    it('should return early when no GHSAs are provided and none are discovered', async () => {
      // Discovery returns empty array.
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: JSON.stringify([]),
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(true)
      expect(result.data?.fixed).toBe(false)

      // Only discovery call, no fix call since no GHSAs found.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
    })

    it('should discover vulnerabilities when no GHSAs are provided', async () => {
      // First call is for discovery (returns vulnerability IDs).
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: JSON.stringify(['GHSA-aaaa-aaaa-aaaa', 'GHSA-bbbb-bbbb-bbbb']),
      })

      // Second call is to apply fixes to the discovered IDs.
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(true)

      // When ghsas is empty, it first discovers vulnerabilities, then applies fixes.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(2)

      // First call is discovery (no --apply-fixes-to).
      const discoveryArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(discoveryArgs).toContain('find-vulnerabilities')
      expect(discoveryArgs).not.toContain('--apply-fixes-to')

      // Second call applies fixes to discovered IDs.
      const applyArgs = mockSpawnCoanaDlx.mock.calls[1]?.[0] as string[]
      expect(applyArgs).toContain('--apply-fixes-to')
    })
  })

  describe('PR mode', () => {
    beforeEach(() => {
      // Enable PR mode.
      mockGetFixEnv.mockResolvedValue({
        baseBranch: 'main',
        githubToken: 'test-token',
        gitEmail: 'test@example.com',
        gitUser: 'test-user',
        isCi: true,
        repoInfo: {
          defaultBranch: 'main',
          owner: 'test-owner',
          repo: 'test-repo',
        },
      })

      mockGetSocketFixPrs.mockResolvedValue([])
      mockFetchGhsaDetails.mockResolvedValue(new Map())
    })

    it('should process only N GHSAs when --pr-limit N is specified in PR mode', async () => {
      const ghsas = [
        'GHSA-aaaa-aaaa-aaaa',
        'GHSA-bbbb-bbbb-bbbb',
        'GHSA-cccc-cccc-cccc',
        'GHSA-dddd-dddd-dddd',
      ]

      // First call discovers vulnerabilities.
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: JSON.stringify(ghsas),
      })

      // Subsequent calls are for individual GHSA fixes.
      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: ['package.json'],
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [], // Empty to trigger discovery.
        prLimit: 2,
      })

      expect(result.ok).toBe(true)

      // First call to discover vulnerabilities, then 2 calls for the fixes.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(3)
    })

    it('should adjust prLimit based on existing open PRs', async () => {
      const ghsas = [
        'GHSA-aaaa-aaaa-aaaa',
        'GHSA-bbbb-bbbb-bbbb',
        'GHSA-cccc-cccc-cccc',
      ]

      // Mock 1 existing open PR.
      mockGetSocketFixPrs.mockResolvedValueOnce([
        { number: 123, state: 'OPEN' },
      ])

      // Second call returns no open PRs for specific GHSAs.
      mockGetSocketFixPrs.mockResolvedValue([])

      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: true,
        data: JSON.stringify(ghsas),
      })

      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: ['package.json'],
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [], // Empty to trigger discovery.
        prLimit: 3,
      })

      expect(result.ok).toBe(true)

      // With prLimit 3 and 1 existing PR, adjusted limit is 2.
      // So: 1 discovery call + 2 fix calls = 3 total.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(3)
    })

    it('should process no GHSAs when existing open PRs exceed prLimit', async () => {
      // Mock 5 existing open PRs.
      mockGetSocketFixPrs.mockResolvedValue([
        { number: 1, state: 'OPEN' },
        { number: 2, state: 'OPEN' },
        { number: 3, state: 'OPEN' },
        { number: 4, state: 'OPEN' },
        { number: 5, state: 'OPEN' },
      ])

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [], // Empty to trigger discovery.
        prLimit: 3,
      })

      expect(result.ok).toBe(true)
      expect(result.data?.fixed).toBe(false)

      // With 5 open PRs and prLimit 3, adjusted limit is 0, so no processing.
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })
  })

  describe('--id filtering in local mode', () => {
    it('should process all provided GHSA IDs in local mode (prLimit ignored)', async () => {
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
        prLimit: 2, // Should be ignored in local mode.
      })

      expect(result.ok).toBe(true)

      // Should process all 5 GHSAs in local mode (prLimit is ignored).
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      const applyFixesIndex = callArgs.indexOf('--apply-fixes-to')
      const ghsaArgs = callArgs
        .slice(applyFixesIndex + 1)
        .filter(arg => arg.startsWith('GHSA-'))

      expect(ghsaArgs).toHaveLength(5)
      expect(ghsaArgs).toEqual([
        'GHSA-1111-1111-1111',
        'GHSA-2222-2222-2222',
        'GHSA-3333-3333-3333',
        'GHSA-4444-4444-4444',
        'GHSA-5555-5555-5555',
      ])
    })

    it('should handle single GHSA ID in local mode', async () => {
      const ghsas = ['GHSA-1111-1111-1111']

      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
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
})
