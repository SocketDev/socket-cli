import { beforeEach, describe, expect, it, vi } from 'vitest'

import { coanaFix, extractFixMethods } from './coana-fix.mts'

import type { FixConfig } from './types.mts'

// Mock all external dependencies (mirrors handle-fix-limit.test.mts).
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

const baseConfig: FixConfig = {
  all: false,
  allowOverrides: false,
  applyFixes: true,
  autopilot: false,
  coanaVersion: undefined,
  cwd: '/test/cwd',
  debug: false,
  disableExternalToolChecks: false,
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
  silence: false,
  spinner: undefined,
  unknownFlags: [],
}

describe('socket fix --allow-overrides flag forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSetupSdk.mockResolvedValue({
      ok: true,
      data: { uploadManifestFiles: vi.fn() },
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
    // Local mode by default (no CI, no repo).
    mockGetFixEnv.mockResolvedValue({
      githubToken: '',
      gitUserEmail: '',
      gitUserName: '',
      isCi: false,
      repoInfo: null,
    })
    mockGitUnstagedModifiedFiles.mockResolvedValue({ ok: true, data: [] })
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: 'fix applied' })
  })

  describe('local mode', () => {
    it('forwards --allow-overrides to coana when the flag is set', async () => {
      const result = await coanaFix({
        ...baseConfig,
        allowOverrides: true,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(true)
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(callArgs).toContain('compute-fixes-and-upgrade-purls')
      expect(callArgs).toContain('--allow-overrides')
    })

    it('omits --allow-overrides when the flag is not set', async () => {
      const result = await coanaFix({
        ...baseConfig,
        allowOverrides: false,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(true)
      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(callArgs).not.toContain('--allow-overrides')
    })

    it('returns an empty fixMethods array alongside the result', async () => {
      const result = await coanaFix({
        ...baseConfig,
        allowOverrides: true,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(result.ok).toBe(true)
      expect(Array.isArray(result.data?.fixMethods)).toBe(true)
    })
  })

  describe('CI / PR mode', () => {
    beforeEach(() => {
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
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: ['package.json'],
      })
    })

    it('forwards --allow-overrides to the per-GHSA coana invocation', async () => {
      await coanaFix({
        ...baseConfig,
        allowOverrides: true,
        // Provide an explicit GHSA so no discovery call is made; the only
        // spawn is the per-GHSA fix invocation.
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(callArgs).toContain('compute-fixes-and-upgrade-purls')
      expect(callArgs).toContain('--apply-fixes-to')
      expect(callArgs).toContain('--allow-overrides')
    })

    it('omits --allow-overrides from the per-GHSA invocation when unset', async () => {
      await coanaFix({
        ...baseConfig,
        allowOverrides: false,
        ghsas: ['GHSA-1111-1111-1111'],
      })

      expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
      const callArgs = mockSpawnCoanaDlx.mock.calls[0]?.[0] as string[]
      expect(callArgs).not.toContain('--allow-overrides')
    })
  })
})

describe('extractFixMethods', () => {
  it('distinguishes override from upgrade per coana fix entry', () => {
    const entries = extractFixMethods({
      type: 'applied-fixes',
      fixes: {
        'GHSA-aaaa-aaaa-aaaa': [
          {
            purl: 'pkg:npm/lodash@4.17.21',
            fixedVersion: '4.17.21',
            method: 'override',
          },
        ],
        'GHSA-bbbb-bbbb-bbbb': [
          {
            purl: 'pkg:npm/minimist@1.2.6',
            fixedVersion: '1.2.6',
            method: 'upgrade',
          },
        ],
      },
    })

    expect(entries).toEqual([
      {
        ghsaId: 'GHSA-aaaa-aaaa-aaaa',
        fixedVersion: '4.17.21',
        method: 'override',
        purl: 'pkg:npm/lodash@4.17.21',
      },
      {
        ghsaId: 'GHSA-bbbb-bbbb-bbbb',
        fixedVersion: '1.2.6',
        method: 'upgrade',
        purl: 'pkg:npm/minimist@1.2.6',
      },
    ])
  })

  it('defaults a missing method to upgrade (backward-compatible with older coana)', () => {
    const entries = extractFixMethods({
      fixes: {
        'GHSA-cccc-cccc-cccc': [
          { purl: 'pkg:npm/ws@5.2.0', fixedVersion: '5.2.4' },
        ],
      },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.method).toBe('upgrade')
  })

  it('treats an unrecognized method value as upgrade', () => {
    const entries = extractFixMethods({
      fixes: {
        'GHSA-dddd-dddd-dddd': [
          {
            purl: 'pkg:npm/y18n@4.0.0',
            fixedVersion: '4.0.3',
            method: 'something-new',
          },
        ],
      },
    })

    expect(entries[0]?.method).toBe('upgrade')
  })

  it('omits fixedVersion when coana does not provide one', () => {
    const entries = extractFixMethods({
      fixes: {
        'GHSA-eeee-eeee-eeee': [
          { purl: 'pkg:npm/axios@0.21.0', method: 'override' },
        ],
      },
    })

    expect(entries[0]).toEqual({
      ghsaId: 'GHSA-eeee-eeee-eeee',
      method: 'override',
      purl: 'pkg:npm/axios@0.21.0',
    })
  })

  it('skips entries without a purl and non-array fix lists', () => {
    const entries = extractFixMethods({
      fixes: {
        // Non-array value (e.g. the only-direct-dependency-upgrades shape).
        'GHSA-ffff-ffff-ffff': { directDependencies: [] },
        'GHSA-gggg-gggg-gggg': [{ fixedVersion: '1.0.0', method: 'override' }],
        'GHSA-hhhh-hhhh-hhhh': [
          { purl: 'pkg:npm/ok@1.0.0', method: 'override' },
        ],
      },
    })

    expect(entries).toEqual([
      {
        ghsaId: 'GHSA-hhhh-hhhh-hhhh',
        method: 'override',
        purl: 'pkg:npm/ok@1.0.0',
      },
    ])
  })

  it('returns an empty array for non-object or fixes-less input', () => {
    expect(extractFixMethods(null)).toEqual([])
    expect(extractFixMethods(undefined)).toEqual([])
    expect(extractFixMethods('nope')).toEqual([])
    expect(extractFixMethods({})).toEqual([])
    expect(extractFixMethods({ type: 'no-vulnerabilities-found' })).toEqual([])
  })
})
