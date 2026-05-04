import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCreateNewScan } from './handle-create-new-scan.mts'

const {
  mockFetchCreateOrgFullScan,
  mockFetchSupportedScanFileNames,
  mockFindSocketYmlSync,
  mockGetPackageFilesForScan,
  mockPerformReachabilityAnalysis,
  mockReadOrDefaultSocketJson,
} = vi.hoisted(() => ({
  mockFetchCreateOrgFullScan: vi.fn(),
  mockFetchSupportedScanFileNames: vi.fn(),
  mockFindSocketYmlSync: vi.fn(),
  mockGetPackageFilesForScan: vi.fn(),
  mockPerformReachabilityAnalysis: vi.fn(),
  mockReadOrDefaultSocketJson: vi.fn(),
}))

vi.mock('./fetch-create-org-full-scan.mts', () => ({
  fetchCreateOrgFullScan: mockFetchCreateOrgFullScan,
}))

vi.mock('./fetch-supported-scan-file-names.mts', () => ({
  fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
}))

vi.mock('./finalize-tier1-scan.mts', () => ({
  finalizeTier1Scan: vi.fn(),
}))

vi.mock('./handle-scan-report.mts', () => ({
  handleScanReport: vi.fn(),
}))

vi.mock('./output-create-new-scan.mts', () => ({
  outputCreateNewScan: vi.fn(),
}))

vi.mock('./perform-reachability-analysis.mts', () => ({
  performReachabilityAnalysis: mockPerformReachabilityAnalysis,
}))

vi.mock('../../utils/config.mts', () => ({
  findSocketYmlSync: mockFindSocketYmlSync,
}))

vi.mock('../../utils/path-resolve.mts', () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))

vi.mock('../../utils/socket-json.mts', () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

vi.mock('../manifest/detect-manifest-actions.mts', () => ({
  detectManifestActions: vi.fn(() => Promise.resolve({ count: 0 })),
}))

vi.mock('../manifest/generate_auto_manifest.mts', () => ({
  generateAutoManifest: vi.fn(),
}))

describe('handleCreateNewScan excludePaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockFetchCreateOrgFullScan.mockResolvedValue({
      data: { id: 'scan-id' },
      ok: true,
    })
    mockFetchSupportedScanFileNames.mockResolvedValue({
      data: { size: 1 },
      ok: true,
    })
    mockFindSocketYmlSync.mockReturnValue({
      data: { parsed: { projectIgnorePaths: ['fixtures/**'] } },
      ok: true,
    })
    mockGetPackageFilesForScan.mockResolvedValue(['package.json'])
    mockPerformReachabilityAnalysis.mockResolvedValue({
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: 'tier1-id',
      },
      ok: true,
    })
    mockReadOrDefaultSocketJson.mockReturnValue({})
  })

  it('adds excludePaths to manifest discovery and reachability excludes', async () => {
    await handleCreateNewScan({
      autoManifest: false,
      branchName: 'main',
      commitHash: '',
      commitMessage: '',
      committers: '',
      cwd: '/repo',
      defaultBranch: false,
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      pendingHead: false,
      pullRequest: 0,
      reach: {
        excludePaths: ['tests', 'packages/*'],
        reachAnalysisMemoryLimit: 8192,
        reachAnalysisTimeout: 0,
        reachConcurrency: 1,
        reachContinueOnAnalysisErrors: false,
        reachContinueOnInstallErrors: false,
        reachContinueOnMissingLockFiles: false,
        reachContinueOnNoSourceFiles: false,
        reachDebug: false,
        reachDetailedAnalysisLogFile: false,
        reachDisableAnalytics: false,
        reachDisableExternalToolChecks: false,
        reachEcosystems: [],
        reachEnableAnalysisSplitting: false,
        reachExcludePaths: ['dist'],
        reachLazyMode: false,
        reachSkipCache: false,
        reachUseOnlyPregeneratedSboms: false,
        reachVersion: undefined,
        runReachabilityAnalysis: true,
      },
      readOnly: false,
      repoName: 'repo',
      report: false,
      reportLevel: 'error',
      targets: ['/repo'],
      tmp: false,
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo'],
      { size: 1 },
      {
        config: {
          projectIgnorePaths: ['fixtures/**', 'tests/**', 'packages/*/**'],
        },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        reachabilityOptions: expect.objectContaining({
          reachExcludePaths: ['dist', 'tests/**', 'packages/*'],
        }),
      }),
    )
  })

  it('does not apply excludePaths when reachability is disabled', async () => {
    await handleCreateNewScan({
      autoManifest: false,
      branchName: 'main',
      commitHash: '',
      commitMessage: '',
      committers: '',
      cwd: '/repo',
      defaultBranch: false,
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      pendingHead: false,
      pullRequest: 0,
      reach: {
        excludePaths: ['tests'],
        reachAnalysisMemoryLimit: 8192,
        reachAnalysisTimeout: 0,
        reachConcurrency: 1,
        reachContinueOnAnalysisErrors: false,
        reachContinueOnInstallErrors: false,
        reachContinueOnMissingLockFiles: false,
        reachContinueOnNoSourceFiles: false,
        reachDebug: false,
        reachDetailedAnalysisLogFile: false,
        reachDisableAnalytics: false,
        reachDisableExternalToolChecks: false,
        reachEcosystems: [],
        reachEnableAnalysisSplitting: false,
        reachExcludePaths: [],
        reachLazyMode: false,
        reachSkipCache: false,
        reachUseOnlyPregeneratedSboms: false,
        reachVersion: undefined,
        runReachabilityAnalysis: false,
      },
      readOnly: false,
      repoName: 'repo',
      report: false,
      reportLevel: 'error',
      targets: ['/repo'],
      tmp: false,
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo'],
      { size: 1 },
      {
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).not.toHaveBeenCalled()
  })
})
