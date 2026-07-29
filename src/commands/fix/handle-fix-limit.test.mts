import { promises as fs } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

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

// Discovery always uses `find-vulnerabilities --output-file`: mock Coana by
// writing the structured result file on the discovery call and succeeding on
// the fix call.
function mockDiscoveryEnvelope(envelope: {
  ghsaIds: string[]
  artifactCount?: number
  filteredArtifactCount?: number
}) {
  mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
    if (args[0] === 'find-vulnerabilities') {
      const idx = args.indexOf('--output-file')
      expect(idx).toBeGreaterThan(-1)
      await fs.writeFile(
        args[idx + 1]!,
        JSON.stringify({
          artifactCount: envelope.ghsaIds.length,
          filteredArtifactCount: envelope.ghsaIds.length,
          ...envelope,
        }),
      )
      return { ok: true, data: '' }
    }
    return { ok: true, data: 'fix applied' }
  })
}

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
    excludePaths: [],
    ghsas: [],
    include: [],
    minSatisfying: false,
    minimumReleaseAge: '',
    orgSlug: 'test-org',
    outputFile: '',
    packageManagers: [],
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
      mockDiscoveryEnvelope({ ghsaIds: [] })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(true)
      expect(result.data?.fixedAll).toBe(false)

      // Only discovery call, no fix call since no GHSAs found.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
    })

    it('should discover vulnerabilities when no GHSAs are provided', async () => {
      mockDiscoveryEnvelope({
        ghsaIds: ['GHSA-aaaa-aaaa-aaaa', 'GHSA-bbbb-bbbb-bbbb'],
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
      mockDiscoveryEnvelope({
        ghsaIds: [
          'GHSA-aaaa-aaaa-aaaa',
          'GHSA-bbbb-bbbb-bbbb',
          'GHSA-cccc-cccc-cccc',
          'GHSA-dddd-dddd-dddd',
        ],
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
      // Mock 1 existing open PR.
      mockGetSocketFixPrs.mockResolvedValueOnce([
        { number: 123, state: 'OPEN' },
      ])

      // Second call returns no open PRs for specific GHSAs.
      mockGetSocketFixPrs.mockResolvedValue([])

      mockDiscoveryEnvelope({
        ghsaIds: [
          'GHSA-aaaa-aaaa-aaaa',
          'GHSA-bbbb-bbbb-bbbb',
          'GHSA-cccc-cccc-cccc',
        ],
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
      expect(result.data?.fixedAll).toBe(false)

      // With 5 open PRs and prLimit 3, adjusted limit is 0, so no processing.
      expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
    })
  })

  describe('GHSA discovery failure propagation', () => {
    it('propagates a failed discovery spawn instead of reporting success', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: false,
        message: 'Coana exited with code 1',
        cause:
          'Socket compute-artifacts failed: upstream timeout (code=timeout)',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Coana exited with code 1')
      // Discovery failed, so no fix call should follow.
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
    })

    it('propagates discovery failures in PR mode', async () => {
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

      mockSpawnCoanaDlx.mockResolvedValueOnce({
        ok: false,
        message: 'Coana exited with code 1',
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
        prLimit: 2,
      })

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Coana exited with code 1')
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
    })
  })

  describe('structured discovery result (--output-file)', () => {
    it('reads discovered GHSA IDs from the result file', async () => {
      mockDiscoveryEnvelope({
        ghsaIds: ['GHSA-aaaa-aaaa-aaaa'],
        artifactCount: 3,
        filteredArtifactCount: 3,
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(true)
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(2)
    })

    it('fails when Coana does not write the result file', async () => {
      mockSpawnCoanaDlx.mockResolvedValueOnce({ ok: true, data: '' })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/did not write/i)
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
    })

    it('fails when the result file is not valid JSON', async () => {
      mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
        const idx = args.indexOf('--output-file')
        await fs.writeFile(args[idx + 1]!, 'not json')
        return { ok: true, data: '' }
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/could not parse/i)
    })

    it('fails when ghsaIds in the result file is not a string array', async () => {
      mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
        const idx = args.indexOf('--output-file')
        await fs.writeFile(args[idx + 1]!, JSON.stringify({ ghsaIds: [123] }))
        return { ok: true, data: '' }
      })

      const result = await coanaFix({
        ...baseConfig,
        ghsas: [],
      })

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/unexpected vulnerability discovery/i)
    })

    it('warns when the backend resolved zero artifacts', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      mockDiscoveryEnvelope({
        ghsaIds: [],
        artifactCount: 0,
        filteredArtifactCount: 0,
      })

      try {
        const result = await coanaFix({
          ...baseConfig,
          ghsas: [],
        })

        expect(result.ok).toBe(true)
        expect(result.data?.fixedAll).toBe(false)
        // Discovery succeeded with an empty list, so no fix call follows.
        expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/0 artifacts/i),
        )
      } finally {
        warnSpy.mockRestore()
      }
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

  describe('--exclude-paths flag', () => {
    it('passes excludePaths to getPackageFilesForScan as anchored ignore patterns', async () => {
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'fix applied' })

      await coanaFix({
        ...baseConfig,
        excludePaths: ['data/postgres/pgdata', '**/.cache'],
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(mockGetPackageFilesForScan).toHaveBeenCalledTimes(1)
      const [, , opts] = mockGetPackageFilesForScan.mock.calls[0] ?? []
      // excludePathToScanIgnores emits both the entry itself and a /** sibling
      // unless the user already passed a /** suffix.
      expect(opts.additionalIgnores).toEqual([
        'data/postgres/pgdata',
        'data/postgres/pgdata/**',
        '**/.cache',
        '**/.cache/**',
      ])
    })

    it('omits additionalIgnores when excludePaths is empty', async () => {
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'fix applied' })

      await coanaFix({
        ...baseConfig,
        excludePaths: [],
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(mockGetPackageFilesForScan).toHaveBeenCalledTimes(1)
      const [, , opts] = mockGetPackageFilesForScan.mock.calls[0] ?? []
      expect(opts.additionalIgnores).toBeUndefined()
    })

    it('forwards excludePaths to coana --exclude alongside --exclude values', async () => {
      mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'fix applied' })

      await coanaFix({
        ...baseConfig,
        exclude: ['legacy-workspace'],
        excludePaths: ['data/postgres/pgdata'],
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      const excludeIndex = callArgs.indexOf('--exclude')
      expect(excludeIndex).toBeGreaterThan(-1)
      // --exclude is followed by every pattern from both sources, in order:
      // legacy --exclude entries first, then --exclude-paths entries.
      expect(callArgs.slice(excludeIndex + 1, excludeIndex + 3)).toEqual([
        'legacy-workspace',
        'data/postgres/pgdata',
      ])
    })
  })
})
