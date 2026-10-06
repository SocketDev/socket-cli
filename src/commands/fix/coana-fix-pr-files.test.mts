import { promises as fs } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { coanaFix } from './coana-fix.mts'

import type { FixConfig } from './types.mts'

const mockSpawnCoanaDlx = vi.hoisted(() => vi.fn())
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
const mockGetPackageFilesForScan = vi.hoisted(() => vi.fn())
const mockHandleApiCall = vi.hoisted(() => vi.fn())
const mockGetFixEnv = vi.hoisted(() => vi.fn())
const mockGetSocketFixPrs = vi.hoisted(() => vi.fn())
const mockFetchGhsaDetails = vi.hoisted(() => vi.fn())
const mockGitUnstagedModifiedFiles = vi.hoisted(() => vi.fn())
const mockGitUntrackedFiles = vi.hoisted(() => vi.fn())
const mockGitCommit = vi.hoisted(() => vi.fn())

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
  openSocketFixPr: vi.fn(async () => ({ ok: false, error: new Error('') })),
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

vi.mock('./branch-cleanup.mts', () => ({
  cleanupErrorBranches: vi.fn(),
  cleanupFailedPrBranches: vi.fn(),
  cleanupStaleBranch: vi.fn(() => Promise.resolve(true)),
  cleanupSuccessfulPrLocalBranch: vi.fn(),
}))

type Worktree = { modified: string[]; untracked: string[] }

function committedFiles(): string[] {
  expect(mockGitCommit).toHaveBeenCalledTimes(1)
  return mockGitCommit.mock.calls[0]![1] as string[]
}

describe('socket fix PR mode commits', () => {
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
    ghsas: ['GHSA-f8q6-p94x-37v3'],
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

  let worktree: Worktree

  function applyFix(
    changes: Worktree,
    modifiedFiles: string[] | undefined,
  ): void {
    mockSpawnCoanaDlx.mockImplementation(async (args: string[]) => {
      worktree = {
        modified: [...new Set([...worktree.modified, ...changes.modified])],
        untracked: [...new Set([...worktree.untracked, ...changes.untracked])],
      }
      await fs.writeFile(
        args[args.indexOf('--output-file') + 1]!,
        JSON.stringify({ type: 'applied-fixes', fixes: {}, modifiedFiles }),
      )
      return { ok: true, data: '' }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    worktree = { modified: [], untracked: [] }
    mockSetupSdk.mockResolvedValue({
      ok: true,
      data: { uploadManifestFiles: vi.fn() },
    })
    mockFetchSupportedScanFileNames.mockResolvedValue({ ok: true, data: {} })
    mockGetPackageFilesForScan.mockResolvedValue([
      '/test/cwd/package.json',
      '/test/cwd/package-lock.json',
      '/test/cwd/pnpm-lock.yaml',
    ])
    mockHandleApiCall.mockResolvedValue({ ok: true, data: { tarHash: 'hash' } })
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
    mockGitUnstagedModifiedFiles.mockImplementation(async () => ({
      ok: true,
      data: worktree.modified,
    }))
    mockGitUntrackedFiles.mockImplementation(async () => ({
      ok: true,
      data: worktree.untracked,
    }))
    mockGitCommit.mockResolvedValue(true)
  })

  it.each(['package-lock.json', 'pnpm-lock.yaml'])(
    'commits a transitive override bump coana leaves out of modifiedFiles (%s)',
    async lockfile => {
      applyFix({ modified: ['package.json', lockfile], untracked: [] }, [
        lockfile,
      ])

      await coanaFix(baseConfig)

      expect(committedFiles()).toEqual(['package.json', lockfile])
    },
  )

  it('commits changed tracked files when coana reports no modifiedFiles', async () => {
    applyFix(
      {
        modified: ['app/build.gradle', 'gradle/versions.gradle'],
        untracked: [],
      },
      undefined,
    )

    await coanaFix(baseConfig)

    expect(committedFiles()).toEqual([
      'app/build.gradle',
      'gradle/versions.gradle',
    ])
  })

  it('leaves out files that were dirty before the fix unless coana reports them', async () => {
    worktree = {
      modified: ['README.md', 'package-lock.json'],
      untracked: ['notes.txt', 'app/.socket.facts.json'],
    }
    applyFix({ modified: ['package.json'], untracked: [] }, [
      'package-lock.json',
    ])

    await coanaFix(baseConfig)

    expect(committedFiles()).toEqual(['package-lock.json', 'package.json'])
  })

  it('commits new files only when coana reports them or they are manifests', async () => {
    applyFix(
      {
        modified: ['build.sbt'],
        untracked: [
          'project/SocketDependencyOverrides.scala',
          'sub/package-lock.json',
          'target/classes/App.class',
        ],
      },
      ['build.sbt', 'project/SocketDependencyOverrides.scala'],
    )

    await coanaFix(baseConfig)

    expect(committedFiles()).toEqual([
      'build.sbt',
      'project/SocketDependencyOverrides.scala',
      'sub/package-lock.json',
    ])
  })

  it('skips the fix when it changes nothing', async () => {
    worktree = { modified: ['package.json'], untracked: [] }
    applyFix({ modified: [], untracked: [] }, [])

    await coanaFix(baseConfig)

    expect(mockGitCommit).not.toHaveBeenCalled()
  })
})
