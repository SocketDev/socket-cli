import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleScanReach } from './handle-scan-reach.mts'

const {
  mockCheckCommandInput,
  mockFetchSupportedScanFileNames,
  mockFinalizeTier1Scan,
  mockFindSocketYmlSync,
  mockGetPackageFilesForScan,
  mockLoggerInfo,
  mockLoggerSuccess,
  mockLoggerWarn,
  mockOutputScanReach,
  mockPerformReachabilityAnalysis,
  mockRunDynamicSbomInference,
  mockSentryInternalsSymbol,
} = vi.hoisted(() => ({
  mockCheckCommandInput: vi.fn(),
  mockFetchSupportedScanFileNames: vi.fn(),
  mockFinalizeTier1Scan: vi.fn(),
  mockFindSocketYmlSync: vi.fn(),
  mockGetPackageFilesForScan: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerSuccess: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockOutputScanReach: vi.fn(),
  mockPerformReachabilityAnalysis: vi.fn(),
  mockRunDynamicSbomInference: vi.fn(),
  mockSentryInternalsSymbol: Symbol('kInternalsSymbol'),
}))

vi.mock('./fetch-supported-scan-file-names.mts', () => ({
  fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
}))

vi.mock('./finalize-tier1-scan.mts', () => ({
  finalizeTier1Scan: mockFinalizeTier1Scan,
}))

vi.mock('./output-scan-reach.mts', () => ({
  outputScanReach: mockOutputScanReach,
}))

vi.mock('./perform-reachability-analysis.mts', () => ({
  performReachabilityAnalysis: mockPerformReachabilityAnalysis,
}))

vi.mock('./run-dynamic-sbom-inference.mts', () => ({
  runDynamicSbomInference: mockRunDynamicSbomInference,
}))

vi.mock('../../constants.mts', () => ({
  default: {
    kInternalsSymbol: mockSentryInternalsSymbol,
    [mockSentryInternalsSymbol]: {
      getSentry: vi.fn(() => undefined),
    },
    spinner: {
      start: vi.fn(),
      stop: vi.fn(),
      successAndStop: vi.fn(),
    },
  },
  // glob.mts pulls NODE_MODULES through the import chain; re-export it
  // here so the streaming-iterables loader inside fast-glob is happy.
  NODE_MODULES: 'node_modules',
  UNKNOWN_ERROR: 'unknown',
}))

vi.mock('../../utils/check-input.mts', () => ({
  checkCommandInput: mockCheckCommandInput,
}))

vi.mock('../../utils/config.mts', () => ({
  findSocketYmlSync: mockFindSocketYmlSync,
}))

vi.mock('../../utils/path-resolve.mts', () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    success: mockLoggerSuccess,
    warn: mockLoggerWarn,
  },
}))

describe('handleScanReach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckCommandInput.mockReturnValue(true)
    mockFetchSupportedScanFileNames.mockResolvedValue({
      ok: true,
      data: { npm: { packageJson: { pattern: 'package.json' } } },
    })
    mockFinalizeTier1Scan.mockResolvedValue({ data: undefined, ok: true })
    mockFindSocketYmlSync.mockReturnValue({
      ok: true,
      data: { parsed: { projectIgnorePaths: ['vendor/**'] } },
    })
    mockGetPackageFilesForScan.mockResolvedValue(['package.json'])
    mockPerformReachabilityAnalysis.mockResolvedValue({
      ok: true,
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: undefined,
      },
    })
    mockRunDynamicSbomInference.mockResolvedValue({
      factsPaths: [],
      resolvedPathsSidecar: undefined,
    })
  })

  it('applies excludePaths to manifest discovery and reachability analysis', async () => {
    const reachabilityOptions = {
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
      reachExcludePaths: ['node_modules'],
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    await handleScanReach({
      cwd: '/repo',
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      outputPath: '',
      reachabilityOptions,
      targets: ['.'],
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['.'],
      { npm: { packageJson: { pattern: 'package.json' } } },
      {
        additionalIgnores: ['tests', 'tests/**', 'packages/*', 'packages/*/**'],
        config: { projectIgnorePaths: ['vendor/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        reachabilityOptions: expect.objectContaining({
          reachExcludePaths: ['node_modules', 'tests', 'packages/*'],
        }),
      }),
    )
  })

  it('translates excludePaths from the scan root for nested targets', async () => {
    const reachabilityOptions = {
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    await handleScanReach({
      cwd: '/repo',
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      outputPath: '',
      reachabilityOptions,
      targets: ['/repo/apps/api'],
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo/apps/api'],
      { npm: { packageJson: { pattern: 'package.json' } } },
      {
        additionalIgnores: [
          'apps/api/tests',
          'apps/api/tests/**',
          '**/dist',
          '**/dist/**',
        ],
        config: { projectIgnorePaths: ['vendor/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        reachabilityOptions: expect.objectContaining({
          reachExcludePaths: ['node_modules', 'tests', '**/dist'],
        }),
      }),
    )
  })

  it('does not invoke Coana when excludePaths remove the whole target from manifest discovery', async () => {
    mockGetPackageFilesForScan.mockResolvedValueOnce([])
    mockCheckCommandInput.mockImplementation(
      (_outputKind: unknown, ...checks: Array<{ test: boolean }>) =>
        checks.every(check => check.test),
    )
    const reachabilityOptions = {
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    await handleScanReach({
      cwd: '/repo',
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      outputPath: '',
      reachabilityOptions,
      targets: ['/repo/apps/api'],
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['/repo/apps/api'],
      { npm: { packageJson: { pattern: 'package.json' } } },
      {
        additionalIgnores: ['apps/api', 'apps/api/**'],
        config: { projectIgnorePaths: ['vendor/**'] },
        cwd: '/repo',
      },
    )
    expect(mockPerformReachabilityAnalysis).not.toHaveBeenCalled()
  })

  it('passes config: undefined when socket.yml is absent', async () => {
    mockFindSocketYmlSync.mockReturnValueOnce({ ok: false })

    const reachabilityOptions = {
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    await handleScanReach({
      cwd: '/repo',
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      outputPath: '',
      reachabilityOptions,
      targets: ['.'],
    })

    expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
      ['.'],
      { npm: { packageJson: { pattern: 'package.json' } } },
      {
        additionalIgnores: ['tests', 'tests/**'],
        config: undefined,
        cwd: '/repo',
      },
    )
  })

  it('finalizes the full application reachability scan with a null report_run_id when Coana returned a scan id', async () => {
    mockPerformReachabilityAnalysis.mockResolvedValueOnce({
      ok: true,
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: 'tier1-id',
      },
    })
    const reachabilityOptions = {
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    await handleScanReach({
      cwd: '/repo',
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      outputPath: '',
      reachabilityOptions,
      targets: ['.'],
    })

    expect(mockFinalizeTier1Scan).toHaveBeenCalledWith('tier1-id', null)
  })

  it('does not call finalize when Coana did not return a full application reachability scan id', async () => {
    const reachabilityOptions = {
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    await handleScanReach({
      cwd: '/repo',
      interactive: false,
      orgSlug: 'fakeOrg',
      outputKind: 'text',
      outputPath: '',
      reachabilityOptions,
      targets: ['.'],
    })

    expect(mockFinalizeTier1Scan).not.toHaveBeenCalled()
  })

  it('warns but still produces scan output when full application reachability finalize fails', async () => {
    mockPerformReachabilityAnalysis.mockResolvedValueOnce({
      ok: true,
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: 'tier1-id',
      },
    })
    // Finalize fails with the CResult error shape; the command must not abort.
    mockFinalizeTier1Scan.mockResolvedValueOnce({
      ok: false,
      message: 'Finalize request failed',
      cause: 'Socket API server error (503)',
    })
    const reachabilityOptions = {
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    // The handler resolves normally (no throw, returns undefined) so the
    // command proceeds and exits 0 rather than being blocked by the failure.
    await expect(
      handleScanReach({
        cwd: '/repo',
        interactive: false,
        orgSlug: 'fakeOrg',
        outputKind: 'text',
        outputPath: '',
        reachabilityOptions,
        targets: ['.'],
      }),
    ).resolves.toBeUndefined()

    expect(mockFinalizeTier1Scan).toHaveBeenCalledWith('tier1-id', null)
    // The failure is surfaced as a single warning carrying message and cause.
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
    const { 0: warnMessage } = mockLoggerWarn.mock.calls[0]
    expect(warnMessage).toContain(
      'Failed to finalize full application reachability scan',
    )
    expect(warnMessage).toContain('Finalize request failed')
    expect(warnMessage).toContain('Socket API server error (503)')
    // Normal scan output is still produced; the command is not blocked.
    expect(mockOutputScanReach).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      { cwd: '/repo', outputKind: 'text', outputPath: '' },
    )
  })
  describe('dynamic SBOM inference', () => {
    const baseReachabilityOptions = {
      dynamicSbomInference: true,
      excludePaths: ['vendor/**'],
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
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
    }

    it('generates per-build-root facts, merges them into manifest discovery, and forwards the sidecar', async () => {
      mockRunDynamicSbomInference.mockResolvedValueOnce({
        factsPaths: [
          '/repo/service-a/.socket.facts.json',
          '/repo/service-b/.socket.facts.json',
        ],
        resolvedPathsSidecar: {
          '/repo/service-a/.socket.facts.json': {
            projects: [],
            components: [],
          },
        },
      })

      await handleScanReach({
        cwd: '/repo',
        interactive: false,
        orgSlug: 'fakeOrg',
        outputKind: 'text',
        outputPath: '',
        reachabilityOptions: baseReachabilityOptions,
        targets: ['/repo'],
      })

      expect(mockRunDynamicSbomInference).toHaveBeenCalledWith({
        cwd: '/repo',
        excludePaths: ['vendor/**'],
        // A caller-owned dir that outlives the analysis consuming its paths.
        sbtTmpDir: expect.any(String),
        withFiles: true,
      })
      expect(mockGetPackageFilesForScan).toHaveBeenCalledWith(
        [
          '/repo',
          '/repo/service-a/.socket.facts.json',
          '/repo/service-b/.socket.facts.json',
        ],
        expect.anything(),
        expect.objectContaining({ cwd: '/repo' }),
      )
      expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          resolvedPathsSidecar: {
            '/repo/service-a/.socket.facts.json': {
              projects: [],
              components: [],
            },
          },
          // The reachability target stays the user's own, never a facts file.
          target: '/repo',
        }),
      )
    })

    it('propagates a build-root failure instead of analyzing a partial set', async () => {
      mockRunDynamicSbomInference.mockRejectedValueOnce(
        new Error('One or more independent build roots failed'),
      )

      await expect(
        handleScanReach({
          cwd: '/repo',
          interactive: false,
          orgSlug: 'fakeOrg',
          outputKind: 'text',
          outputPath: '',
          reachabilityOptions: baseReachabilityOptions,
          targets: ['/repo'],
        }),
      ).rejects.toThrow(/build roots failed/)

      expect(mockPerformReachabilityAnalysis).not.toHaveBeenCalled()
    })

    it('does not run when the flag is off', async () => {
      await handleScanReach({
        cwd: '/repo',
        interactive: false,
        orgSlug: 'fakeOrg',
        outputKind: 'text',
        outputPath: '',
        reachabilityOptions: {
          ...baseReachabilityOptions,
          dynamicSbomInference: false,
        },
        targets: ['/repo'],
      })

      expect(mockRunDynamicSbomInference).not.toHaveBeenCalled()
      expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ resolvedPathsSidecar: undefined }),
      )
    })
  })
})
