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
const mockGitUntrackedFiles = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, data: [] })),
)
const mockGitCommit = vi.hoisted(() => vi.fn())
const mockGenerateSocketFactsForFix = vi.hoisted(() => vi.fn())

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
  gitCommit: mockGitCommit,
  gitCreateBranch: vi.fn(() => Promise.resolve(true)),
  gitDeleteBranch: vi.fn(() => Promise.resolve(true)),
  gitPushBranch: vi.fn(() => Promise.resolve(true)),
  gitRemoteBranchExists: vi.fn(() => Promise.resolve(false)),
  gitResetAndClean: vi.fn(() => Promise.resolve(true)),
  gitUnstagedModifiedFiles: mockGitUnstagedModifiedFiles,
  gitUntrackedFiles: mockGitUntrackedFiles,
}))

vi.mock('./generated-socket-facts.mts', () => ({
  generateSocketFactsForFix: mockGenerateSocketFactsForFix,
}))

vi.mock('./branch-cleanup.mts', () => ({
  cleanupErrorBranches: vi.fn(),
  cleanupFailedPrBranches: vi.fn(),
  cleanupStaleBranch: vi.fn(() => Promise.resolve(true)),
  cleanupSuccessfulPrLocalBranch: vi.fn(),
}))

const FACTS = '/test/cwd/app/.socket.facts.json'

function coanaCalls(command: string): string[][] {
  return mockSpawnCoanaDlx.mock.calls
    .map(call => call[0] as string[])
    .filter(args => args[0] === command)
}

describe('socket fix --dynamic-sbom-inference', () => {
  const baseConfig: FixConfig = {
    all: false,
    applyFixes: true,
    autopilot: false,
    coanaVersion: undefined,
    cwd: '/test/cwd',
    debug: false,
    disableExternalToolChecks: false,
    disableMajorUpdates: false,
    dynamicSbomInference: true,
    ecosystems: [],
    exclude: [],
    excludePaths: [],
    ghsas: ['GHSA-1111-1111-1111', 'GHSA-2222-2222-2222'],
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
    silence: true,
    spinner: undefined,
    unknownFlags: [],
  }
  const uploadManifestFiles = vi.fn()
  const generated = {
    paths: [FACTS],
    sidecarFile: '/tmp/socket-fix-facts/sidecar.json',
    remove: vi.fn(),
    restore: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSetupSdk.mockResolvedValue({ ok: true, data: { uploadManifestFiles } })
    mockFetchSupportedScanFileNames.mockResolvedValue({ ok: true, data: {} })
    mockGetPackageFilesForScan.mockResolvedValue(['/test/cwd/app/build.gradle'])
    mockHandleApiCall.mockResolvedValue({ ok: true, data: { tarHash: 'hash' } })
    mockGenerateSocketFactsForFix.mockResolvedValue(generated)
    mockGetFixEnv.mockResolvedValue({ isCi: false, repoInfo: null })
    mockGitUnstagedModifiedFiles.mockResolvedValue({ ok: true, data: [] })
    mockGitCommit.mockResolvedValue(true)
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: '' })
  })

  it('uploads the generated facts, restricts Maven artifacts to them and removes them', async () => {
    const result = await coanaFix(baseConfig)

    expect(result.ok).toBe(true)
    expect(uploadManifestFiles).toHaveBeenCalledWith(
      'test-org',
      ['/test/cwd/app/build.gradle', FACTS],
      { pathsRelativeTo: '/test/cwd' },
    )
    const args = coanaCalls('compute-fixes-and-upgrade-purls')[0]!
    expect(args).toContain('--maven-use-only-socket-facts')
    expect(args[args.indexOf('--compute-artifacts-sidecar') + 1]).toBe(
      generated.sidecarFile,
    )
    expect(generated.remove).toHaveBeenCalledTimes(1)
  })

  it('discovers vulnerabilities only through the generated facts', async () => {
    mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
      if (args[0] === 'find-vulnerabilities') {
        await fs.writeFile(
          args[args.indexOf('--output-file') + 1]!,
          JSON.stringify({ ghsaIds: [], artifactCount: 1 }),
        )
      }
      return { ok: true, data: '' }
    })

    await coanaFix({ ...baseConfig, all: true, ghsas: [] })

    expect(coanaCalls('find-vulnerabilities')[0]).toContain(
      '--maven-use-only-socket-facts',
    )
  })

  it('still refuses facts files that were already present', async () => {
    mockGetPackageFilesForScan.mockResolvedValue([
      '/test/cwd/app/.socket.facts.json',
    ])

    const result = await coanaFix(baseConfig)

    expect(result.ok).toBe(false)
    expect(mockGenerateSocketFactsForFix).not.toHaveBeenCalled()
  })

  it('does not pass the facts restriction without the flag', async () => {
    await coanaFix({ ...baseConfig, dynamicSbomInference: false })

    expect(mockGenerateSocketFactsForFix).not.toHaveBeenCalled()
    expect(coanaCalls('compute-fixes-and-upgrade-purls')[0]).not.toContain(
      '--maven-use-only-socket-facts',
    )
  })

  describe('in PR mode', () => {
    beforeEach(() => {
      mockGetFixEnv.mockResolvedValue({
        baseBranch: 'main',
        githubToken: 'test-token',
        gitEmail: 'test@example.com',
        gitUser: 'test-user',
        isCi: true,
        repoInfo: { defaultBranch: 'main', owner: 'o', repo: 'r' },
      })
      mockGetSocketFixPrs.mockResolvedValue([])
      mockFetchGhsaDetails.mockResolvedValue(new Map())
    })

    it('restores the facts before every fix, since resetting cleans them away', async () => {
      await coanaFix(baseConfig)

      expect(coanaCalls('compute-fixes-and-upgrade-purls')).toHaveLength(2)
      expect(generated.restore).toHaveBeenCalledTimes(2)
      expect(generated.remove).toHaveBeenCalledTimes(1)
    })

    it('commits the files the fix reports writing', async () => {
      mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
        await fs.writeFile(
          args[args.indexOf('--output-file') + 1]!,
          JSON.stringify({
            type: 'applied-fixes',
            fixes: {},
            modifiedFiles: ['app/build.gradle', 'gradle/versions.gradle'],
          }),
        )
        return { ok: true, data: '' }
      })
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: ['app/build.gradle', 'gradle/versions.gradle', 'README.md'],
      })

      await coanaFix({ ...baseConfig, ghsas: ['GHSA-1111-1111-1111'] })

      expect(mockGitCommit).toHaveBeenCalledWith(
        expect.any(String),
        ['app/build.gradle', 'gradle/versions.gradle'],
        expect.anything(),
      )
    })

    it('commits files the fix creates', async () => {
      mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
        await fs.writeFile(
          args[args.indexOf('--output-file') + 1]!,
          JSON.stringify({
            type: 'applied-fixes',
            fixes: {},
            modifiedFiles: [
              'build.sbt',
              'project/SocketDependencyOverrides.scala',
            ],
          }),
        )
        return { ok: true, data: '' }
      })
      mockGitUnstagedModifiedFiles.mockResolvedValue({
        ok: true,
        data: ['build.sbt'],
      })
      mockGitUntrackedFiles.mockResolvedValue({
        ok: true,
        data: [
          'project/SocketDependencyOverrides.scala',
          'app/.socket.facts.json',
        ],
      })

      await coanaFix({ ...baseConfig, ghsas: ['GHSA-1111-1111-1111'] })

      expect(mockGitCommit).toHaveBeenCalledWith(
        expect.any(String),
        ['build.sbt', 'project/SocketDependencyOverrides.scala'],
        expect.anything(),
      )
    })
  })
})
