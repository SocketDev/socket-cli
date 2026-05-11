import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleScanReach } from './handle-scan-reach.mts'

const {
  mockCheckCommandInput,
  mockFetchSupportedScanFileNames,
  mockFindSocketYmlSync,
  mockGetPackageFilesForScan,
  mockOutputScanReach,
  mockPerformReachabilityAnalysis,
  mockSentryInternalsSymbol,
} = vi.hoisted(() => ({
  mockCheckCommandInput: vi.fn(),
  mockFetchSupportedScanFileNames: vi.fn(),
  mockFindSocketYmlSync: vi.fn(),
  mockGetPackageFilesForScan: vi.fn(),
  mockOutputScanReach: vi.fn(),
  mockPerformReachabilityAnalysis: vi.fn(),
  mockSentryInternalsSymbol: Symbol('kInternalsSymbol'),
}))

vi.mock('./fetch-supported-scan-file-names.mts', () => ({
  fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
}))

vi.mock('./output-scan-reach.mts', () => ({
  outputScanReach: mockOutputScanReach,
}))

vi.mock('./perform-reachability-analysis.mts', () => ({
  performReachabilityAnalysis: mockPerformReachabilityAnalysis,
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
    success: vi.fn(),
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
  })

  it('applies excludePaths to manifest discovery and reachability analysis', async () => {
    const reachabilityOptions = {
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
      reachExcludePaths: ['node_modules'],
      reachLazyMode: false,
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
      excludePaths: ['apps/api/tests', '**/dist'],
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
      reachExcludePaths: ['node_modules'],
      reachLazyMode: false,
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
      excludePaths: ['apps/api'],
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
      reachExcludePaths: ['node_modules'],
      reachLazyMode: false,
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
})
