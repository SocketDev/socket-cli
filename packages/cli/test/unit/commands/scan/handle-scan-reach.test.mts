/**
 * Unit tests for handleScanReach.
 *
 * Purpose:
 * Tests the handler that performs reachability analysis. Validates dependency reachability checks and impact analysis.
 *
 * Test Coverage:
 * - Successful operation flow
 * - Fetch failure handling
 * - Input validation
 * - Output formatting delegation
 * - Error propagation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 * Validates proper data flow through the handler pipeline.
 *
 * Related Files:
 * - src/commands/handleScanReach.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'

// Mock the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockStart = vi.hoisted(() => vi.fn())
const mockStop = vi.hoisted(() => vi.fn())
const mockSuccessAndStop = vi.hoisted(() => vi.fn())
const mockGetSpinner = vi.hoisted(() =>
  vi.fn(() => ({
    start: mockStart,
    stop: mockStop,
    successAndStop: mockSuccessAndStop,
  })),
)
const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
const mockOutputScanReach = vi.hoisted(() => vi.fn())
const mockPerformReachabilityAnalysis = vi.hoisted(() => vi.fn())
const mockCheckCommandInput = vi.hoisted(() => vi.fn())
const mockGetPackageFilesForScan = vi.hoisted(() => vi.fn())
const mockPluralize = vi.hoisted(() => vi.fn(str => str))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('@socketsecurity/lib/constants/process', () => ({
  getSpinner: mockGetSpinner,
}))

vi.mock('@socketsecurity/lib/words', () => ({
  pluralize: mockPluralize,
}))

vi.mock(
  '../../../../src/commands/scan/fetch-supported-scan-file-names.mts',
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)

vi.mock('../../../../src/commands/scan/output-scan-reach.mts', () => ({
  outputScanReach: mockOutputScanReach,
}))

vi.mock(
  '../../../../src/commands/scan/perform-reachability-analysis.mts',
  () => ({
    performReachabilityAnalysis: mockPerformReachabilityAnalysis,
  }),
)

vi.mock('../../../../src/utils/validation/check-input.mts', () => ({
  checkCommandInput: mockCheckCommandInput,
}))

vi.mock('../../../../src/utils/fs/path-resolve.mjs', () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))

const { handleScanReach } = await import(
  '../../../../src/commands/scan/handle-scan-reach.mts'
)

describe('handleScanReach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('performs reachability analysis successfully', async () => {
    const mockFetchSupported = mockFetchSupportedScanFileNames
    const mockOutput = mockOutputScanReach
    const mockPerformAnalysis = mockPerformReachabilityAnalysis
    const mockCheckInput = mockCheckCommandInput
    const mockGetPackageFiles = mockGetPackageFilesForScan

    mockFetchSupported.mockResolvedValue(
      createSuccessResult(['package.json', 'package-lock.json']),
    )
    mockGetPackageFiles.mockResolvedValue([
      '/project/package.json',
      '/project/package-lock.json',
    ])
    mockCheckInput.mockReturnValue(true)
    mockPerformAnalysis.mockResolvedValue(
      createSuccessResult({
        reachablePackages: 10,
        totalPackages: 50,
      }),
    )

    await handleScanReach({
      cwd: '/project',
      interactive: false,
      orgSlug: 'test-org',
      outputKind: 'json',
      reachabilityOptions: {
        reachAnalysisTimeout: 300,
        reachAnalysisMemoryLimit: 2048,
        reachDisableAnalytics: false,
        reachEcosystems: [],
        reachExcludePaths: [],
        reachMinSeverity: 'low',
        reachSkipCache: false,
        reachUseUnreachableFromPrecomputation: false,
      },
      targets: ['src'],
    })

    expect(mockPerformAnalysis).toHaveBeenCalledWith({
      cwd: '/project',
      orgSlug: 'test-org',
      outputPath: undefined,
      packagePaths: ['/project/package.json', '/project/package-lock.json'],
      reachabilityOptions: {
        reachAnalysisTimeout: 300,
        reachAnalysisMemoryLimit: 2048,
        reachDisableAnalytics: false,
        reachEcosystems: [],
        reachExcludePaths: [],
        reachMinSeverity: 'low',
        reachSkipCache: false,
        reachUseUnreachableFromPrecomputation: false,
      },
      spinner: expect.any(Object),
      target: 'src',
      uploadManifests: true,
    })
    expect(mockOutput).toHaveBeenCalled()
  })

  it('handles supported files fetch failure', async () => {
    const mockFetchSupported = mockFetchSupportedScanFileNames
    const mockOutput = mockOutputScanReach

    const mockError = createErrorResult('Failed to fetch supported files')
    mockFetchSupported.mockResolvedValue(mockError)

    await handleScanReach({
      cwd: '/project',
      interactive: false,
      orgSlug: 'test-org',
      outputKind: 'text',
      reachabilityOptions: {},
      targets: [],
    })

    expect(mockOutput).toHaveBeenCalledWith(mockError, {
      cwd: '/project',
      outputKind: 'text',
      outputPath: '',
    })
  })

  it('handles no eligible files found', async () => {
    const mockFetchSupported = mockFetchSupportedScanFileNames
    const mockCheckInput = mockCheckCommandInput
    const mockGetPackageFiles = mockGetPackageFilesForScan

    mockFetchSupported.mockResolvedValue(createSuccessResult(['package.json']))
    mockGetPackageFiles.mockResolvedValue([])
    mockCheckInput.mockReturnValue(false)

    await handleScanReach({
      cwd: '/empty',
      interactive: false,
      orgSlug: 'test-org',
      outputKind: 'json',
      reachabilityOptions: {},
      targets: ['nonexistent'],
    })

    expect(mockCheckInput).toHaveBeenCalledWith('json', {
      nook: true,
      test: false,
      fail: 'found no eligible files to analyze',
      message: expect.any(String),
    })
  })

  it('handles reachability analysis failure', async () => {
    const mockFetchSupported = mockFetchSupportedScanFileNames
    const mockOutput = mockOutputScanReach
    const mockPerformAnalysis = mockPerformReachabilityAnalysis
    const mockCheckInput = mockCheckCommandInput
    const mockGetPackageFiles = mockGetPackageFilesForScan

    mockFetchSupported.mockResolvedValue(createSuccessResult(['package.json']))
    mockGetPackageFiles.mockResolvedValue(['/project/package.json'])
    mockCheckInput.mockReturnValue(true)

    const analysisError = createErrorResult('Analysis failed')
    mockPerformAnalysis.mockResolvedValue(analysisError)

    await handleScanReach({
      cwd: '/project',
      interactive: true,
      orgSlug: 'test-org',
      outputKind: 'markdown',
      reachabilityOptions: { maxDepth: 10 },
      targets: ['./'],
    })

    expect(mockOutput).toHaveBeenCalledWith(analysisError, {
      cwd: '/project',
      outputKind: 'markdown',
      outputPath: '',
    })
  })
})
