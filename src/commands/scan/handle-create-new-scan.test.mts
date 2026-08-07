import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'

import type { HandleCreateNewScanConfig } from './handle-create-new-scan.mts'

const {
  mockFetchCreateOrgFullScan,
  mockFetchSupportedScanFileNames,
  mockFindSocketYmlSync,
  mockGenerateAutoManifest,
  mockGenerateRecursiveManifests,
  mockGetPackageFilesForScan,
  mockPerformReachabilityAnalysis,
  mockReadOrDefaultSocketJson,
} = vi.hoisted(() => ({
  mockFetchCreateOrgFullScan: vi.fn(),
  mockFetchSupportedScanFileNames: vi.fn(),
  mockFindSocketYmlSync: vi.fn(),
  mockGenerateAutoManifest: vi.fn(),
  mockGenerateRecursiveManifests: vi.fn(),
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

vi.mock('../manifest/generate-recursive-manifests.mts', () => ({
  generateRecursiveManifests: mockGenerateRecursiveManifests,
}))

vi.mock('../manifest/generate_auto_manifest.mts', () => ({
  generateAutoManifest: mockGenerateAutoManifest,
}))

function createConfig(
  overrides: Partial<HandleCreateNewScanConfig> = {},
): HandleCreateNewScanConfig {
  return {
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
      dynamicSbomInference: false,
      excludePaths: [],
      reachAnalysisMemoryLimit: '8192',
      reachAnalysisTimeout: '',
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
      reachRetainFactsFile: false,
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
    ...overrides,
  }
}

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
    mockGenerateAutoManifest.mockResolvedValue({ generatedFiles: [] })
    mockGenerateRecursiveManifests.mockResolvedValue([])
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

  it('includes generated auto-manifest files in SCA discovery targets', async () => {
    mockGenerateAutoManifest.mockResolvedValueOnce({
      generatedFiles: ['/repo/.socket-auto-manifest/maven_install.json'],
    })

    await handleCreateNewScan(
      createConfig({
        autoManifest: true,
        targets: ['/repo/apps/api'],
      }),
    )

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo/apps/api', '/repo/.socket-auto-manifest/maven_install.json'],
      { size: 1 },
      {
        additionalIgnores: [],
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
    expect(mockFetchCreateOrgFullScan).toHaveBeenCalled()
  })

  it('drives JVM facts generation through generateRecursiveManifests under --dynamic-sbom-inference, merging generated facts into scan targets', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      {
        dir: '/repo/service-a',
        ecosystem: 'maven',
        factsPath: '/repo/service-a/.socket.facts.json',
        status: 'generated',
      },
      {
        dir: '/repo/service-b',
        ecosystem: 'gradle',
        factsPath: '/repo/service-b/.socket.facts.json',
        status: 'generated',
      },
      { dir: '/repo/service-c', ecosystem: 'maven', status: 'empty' },
    ])

    const config = createConfig({ autoManifest: true, targets: ['/repo'] })
    config.reach.dynamicSbomInference = true

    await handleCreateNewScan(config)

    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo',
        sbtTmpDir: undefined,
        withFiles: false,
      }),
    )
    expect(mockGenerateAutoManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        detected: expect.objectContaining({
          gradle: false,
          maven: false,
          sbt: false,
        }),
      }),
    )
    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      [
        '/repo',
        '/repo/service-a/.socket.facts.json',
        '/repo/service-b/.socket.facts.json',
      ],
      { size: 1 },
      {
        additionalIgnores: [],
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
  })

  it('aborts instead of silently uploading a partial scan when a recursive build root fails', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      {
        dir: '/repo/service-a',
        ecosystem: 'maven',
        factsPath: '/repo/service-a/.socket.facts.json',
        status: 'generated',
      },
      { dir: '/repo/service-b', ecosystem: 'maven', status: 'failed' },
    ])

    const config = createConfig({ autoManifest: true, targets: ['/repo'] })
    config.reach.dynamicSbomInference = true

    await expect(handleCreateNewScan(config)).rejects.toThrow(
      /one or more independent build roots failed/i,
    )
    expect(mockGetPackageFilesForScan).not.toHaveBeenCalled()
    expect(mockFetchCreateOrgFullScan).not.toHaveBeenCalled()
  })

  it('aborts when --dynamic-sbom-inference finds no Gradle/sbt/Maven build root', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([])

    const config = createConfig({ autoManifest: true, targets: ['/repo'] })
    config.reach.dynamicSbomInference = true

    await expect(handleCreateNewScan(config)).rejects.toThrow(
      /No Gradle, sbt, or Maven build root was found/,
    )
    expect(mockGetPackageFilesForScan).not.toHaveBeenCalled()
    expect(mockFetchCreateOrgFullScan).not.toHaveBeenCalled()
  })

  it('does not abort when build roots were found but none generated facts (empty/skippedDisabled), unlike genuinely finding none', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      { dir: '/repo/service-a', ecosystem: 'maven', status: 'empty' },
      { dir: '/repo/service-b', ecosystem: 'maven', status: 'skippedDisabled' },
    ])

    const config = createConfig({ autoManifest: true, targets: ['/repo'] })
    config.reach.dynamicSbomInference = true

    await handleCreateNewScan(config)

    expect(mockGetPackageFilesForScan).toHaveBeenCalled()
  })

  it('accumulates a sidecar across recursively discovered build roots and forwards it to reachability analysis', async () => {
    mockGenerateRecursiveManifests.mockImplementationOnce(
      async ({ sidecarAcc }) => {
        sidecarAcc?.set('/repo/service-a/.socket.facts.json', {
          projects: [
            {
              type: 'maven',
              namespace: 'com.example',
              name: 'app',
              version: '1.0',
              subprojectDir: '.',
              dependencies: [],
              resolvedAs: [],
              targets: ['/repo/service-a/build/classes'],
              sources: ['/repo/service-a/src/main/java'],
            },
          ],
          components: [],
        })
        return [
          {
            dir: '/repo/service-a',
            ecosystem: 'maven',
            factsPath: '/repo/service-a/.socket.facts.json',
            status: 'generated',
          },
        ]
      },
    )

    const config = createConfig({ autoManifest: true, targets: ['/repo'] })
    config.reach.dynamicSbomInference = true
    config.reach.runReachabilityAnalysis = true

    await handleCreateNewScan(config)

    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith(
      expect.objectContaining({
        sbtTmpDir: expect.any(String),
        withFiles: true,
      }),
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedPathsSidecar: {
          '/repo/service-a/.socket.facts.json': {
            projects: [expect.objectContaining({ name: 'app' })],
            components: [],
          },
        },
      }),
    )
  })

  it('aborts before scan creation when auto-manifest generation fails', async () => {
    mockGenerateAutoManifest.mockRejectedValueOnce(
      new Error('Bazel auto-manifest generation failed'),
    )

    await expect(
      handleCreateNewScan(createConfig({ autoManifest: true })),
    ).rejects.toThrow('Bazel auto-manifest generation failed')

    expect(mockFetchSupportedScanFileNames).not.toHaveBeenCalled()
    expect(mockFetchCreateOrgFullScan).not.toHaveBeenCalled()
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
        dynamicSbomInference: false,
        excludePaths: ['tests', 'packages/*'],
        reachAnalysisMemoryLimit: '8192',
        reachAnalysisTimeout: '',
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
        reachRetainFactsFile: false,
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
        additionalIgnores: ['tests', 'tests/**', 'packages/*', 'packages/*/**'],
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        reachabilityOptions: expect.objectContaining({
          reachExcludePaths: ['dist', 'tests', 'packages/*'],
        }),
      }),
    )
  })

  it('translates excludePaths from the scan root for nested reachability targets', async () => {
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
        dynamicSbomInference: false,
        excludePaths: ['apps/api/tests', '**/dist'],
        reachAnalysisMemoryLimit: '8192',
        reachAnalysisTimeout: '',
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
        reachExcludePaths: ['node_modules'],
        reachLazyMode: false,
        reachRetainFactsFile: false,
        reachSkipCache: false,
        reachUseOnlyPregeneratedSboms: false,
        reachVersion: undefined,
        runReachabilityAnalysis: true,
      },
      readOnly: false,
      repoName: 'repo',
      report: false,
      reportLevel: 'error',
      targets: ['/repo/apps/api'],
      tmp: false,
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo/apps/api'],
      { size: 1 },
      {
        additionalIgnores: [
          'apps/api/tests',
          'apps/api/tests/**',
          '**/dist',
          '**/dist/**',
        ],
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        target: '/repo/apps/api',
        reachabilityOptions: expect.objectContaining({
          reachExcludePaths: ['node_modules', 'tests', '**/dist'],
        }),
      }),
    )
  })

  it('applies excludePaths to SCA discovery even when reachability is disabled', async () => {
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
        dynamicSbomInference: false,
        excludePaths: ['tests'],
        reachAnalysisMemoryLimit: '8192',
        reachAnalysisTimeout: '',
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
        reachRetainFactsFile: false,
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
        additionalIgnores: ['tests', 'tests/**'],
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).not.toHaveBeenCalled()
  })

  it('does not invoke Coana when excludePaths remove the whole target from manifest discovery', async () => {
    mockGetPackageFilesForScan.mockResolvedValueOnce([])

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
        dynamicSbomInference: false,
        excludePaths: ['apps/api'],
        reachAnalysisMemoryLimit: '8192',
        reachAnalysisTimeout: '',
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
        reachExcludePaths: ['node_modules'],
        reachLazyMode: false,
        reachRetainFactsFile: false,
        reachSkipCache: false,
        reachUseOnlyPregeneratedSboms: false,
        reachVersion: undefined,
        runReachabilityAnalysis: true,
      },
      readOnly: false,
      repoName: 'repo',
      report: false,
      reportLevel: 'error',
      targets: ['/repo/apps/api'],
      tmp: false,
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo/apps/api'],
      { size: 1 },
      {
        additionalIgnores: ['apps/api', 'apps/api/**'],
        config: { projectIgnorePaths: ['fixtures/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).not.toHaveBeenCalled()
  })

  it('passes config: undefined when socket.yml is absent', async () => {
    mockFindSocketYmlSync.mockReturnValueOnce({ ok: false })

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
        dynamicSbomInference: false,
        excludePaths: ['tests'],
        reachAnalysisMemoryLimit: '8192',
        reachAnalysisTimeout: '',
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
        reachRetainFactsFile: false,
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
        additionalIgnores: ['tests', 'tests/**'],
        config: undefined,
        cwd: '/repo',
      },
    )
  })
})

describe('handleCreateNewScan full application reachability finalize', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    mockFetchSupportedScanFileNames.mockResolvedValue({
      data: { size: 1 },
      ok: true,
    })
    mockFindSocketYmlSync.mockReturnValue({ ok: false })
    mockGetPackageFilesForScan.mockResolvedValue(['package.json'])
    mockFetchCreateOrgFullScan.mockResolvedValue({
      data: { id: 'scan-id' },
      ok: true,
    })
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('finalizes the full application reachability scan when a scan id and reachability scan id are present', async () => {
    mockPerformReachabilityAnalysis.mockResolvedValue({
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: 'tier1-id',
      },
      ok: true,
    })

    const config = createConfig()
    config.reach.runReachabilityAnalysis = true

    await handleCreateNewScan(config)

    expect(finalizeTier1Scan).toHaveBeenCalledWith('tier1-id', 'scan-id')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns instead of silently skipping finalize when no full application reachability scan id was extracted', async () => {
    mockPerformReachabilityAnalysis.mockResolvedValue({
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: undefined,
      },
      ok: true,
    })

    const config = createConfig()
    config.reach.runReachabilityAnalysis = true

    await handleCreateNewScan(config)

    expect(finalizeTier1Scan).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]![0])).toMatch(
      /reachability finalize|reachability report was not linked/i,
    )
  })
})
