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

describe('socket fix --limit behavior verification', () => {
  const baseConfig: FixConfig = {
    applyFixes: true,
    autopilot: false,
    cwd: '/test/cwd',
    disableMajorUpdates: false,
    exclude: [],
    ghsas: [],
    include: [],
    limit: 10,
    minSatisfying: false,
    minimumReleaseAge: '',
    orgSlug: 'test-org',
    outputFile: '',
    prCheck: true,
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
    it('should process only N GHSAs when --limit N is specified', async () => {
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
        limit: 3,
      })

      expect(result.ok).toBe(true)

      // Verify spawnCoanaDlx was called once with only the first 3 GHSAs.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(callArgs).toContain('--apply-fixes-to')

      // Find the index of --apply-fixes-to and check the next arguments.
      const applyFixesIndex = callArgs.indexOf('--apply-fixes-to')
      const ghsaArgs = callArgs
        .slice(applyFixesIndex + 1)
        .filter(arg => arg.startsWith('GHSA-'))

      expect(ghsaArgs).toEqual([
        'GHSA-1111-1111-1111',
        'GHSA-2222-2222-2222',
        'GHSA-3333-3333-3333',
      ])
    })

    it('should process all GHSAs when limit exceeds GHSA count', async () => {
      const ghsas = ['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222']

      mockSpawnCoanaDlx.mockResolvedValue({
        ok: true,
        data: 'fix applied',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
        limit: 10,
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

    it('should process no GHSAs when --limit 0 is specified', async () => {
      const ghsas = [
        'GHSA-1111-1111-1111',
        'GHSA-2222-2222-2222',
        'GHSA-3333-3333-3333',
      ]

      const result = await coanaFix({
        ...baseConfig,
        ghsas,
        limit: 0,
      })

      expect(result.ok).toBe(true)
      expect(result.data?.fixed).toBe(false)

      // spawnCoanaDlx should not be called at all with limit 0.
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
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
        limit: 10,
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
        githubToken: 'test-token',
        gitUserEmail: 'test@example.com',
        gitUserName: 'test-user',
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

    it('should process only N GHSAs when --limit N is specified in PR mode', async () => {
      const ghsas = [
        'GHSA-aaaa-aaaa-aaaa',
        'GHSA-bbbb-bbbb-bbbb',
        'GHSA-cccc-cccc-cccc',
        'GHSA-dddd-dddd-dddd',
      ]

      // First call returns the IDs to process.
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
        ghsas: ['all'],
        limit: 2,
      })

      expect(result.ok).toBe(true)

      // First call to discover vulnerabilities, then 2 calls for the fixes.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(3)
    })

    it('should adjust limit based on existing open PRs', async () => {
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
        ghsas: ['all'],
        limit: 3,
      })

      expect(result.ok).toBe(true)

      // With limit 3 and 1 existing PR, adjusted limit is 2.
      // So: 1 discovery call + 2 fix calls = 3 total.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(3)
    })

    it('should process no GHSAs when existing open PRs exceed limit', async () => {
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
        ghsas: ['all'],
        limit: 3,
      })

      expect(result.ok).toBe(true)
      expect(result.data?.fixed).toBe(false)

      // With 5 open PRs and limit 3, adjusted limit is 0, so no processing.
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })
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
        limit: 2,
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
        limit: 1,
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
