import { describe, expect, it, vi } from 'vitest'

import { handleScanReach } from './handle-scan-reach.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../test/helpers/mocks.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    success: vi.fn(),
  },
}))

vi.mock('@socketsecurity/lib/constants/process', () => ({
  getSpinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    successAndStop: vi.fn(),
  })),
}))

vi.mock('./fetch-supported-scan-file-names.mts', () => ({
  fetchSupportedScanFileNames: vi.fn(),
}))

vi.mock('./output-scan-reach.mts', () => ({
  outputScanReach: vi.fn(),
}))

vi.mock('./perform-reachability-analysis.mts', () => ({
  performReachabilityAnalysis: vi.fn(),
}))

vi.mock('../../utils/validation/check-input.mts', () => ({
  checkCommandInput: vi.fn(),
}))

vi.mock('../../utils/fs/path-resolve.mjs', () => ({
  getPackageFilesForScan: vi.fn(),
}))

describe('handleScanReach', () => {
  it('performs reachability analysis successfully', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { outputScanReach } = await import('./output-scan-reach.mts')
    const { performReachabilityAnalysis } = await import(
      './perform-reachability-analysis.mts'
    )
    const { checkCommandInput } = await import(
      '../../utils/validation/check-input.mts'
    )
    const { getPackageFilesForScan } = await import(
      '../../utils/fs/path-resolve.mjs'
    )

    const mockFetchSupported = vi.mocked(fetchSupportedScanFileNames)
    const mockOutput = vi.mocked(outputScanReach)
    const mockPerformAnalysis = vi.mocked(performReachabilityAnalysis)
    const mockCheckInput = vi.mocked(checkCommandInput)
    const mockGetPackageFiles = vi.mocked(getPackageFilesForScan)

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
      reachabilityOptions: { depth: 5 },
      targets: ['src'],
    })

    expect(mockPerformAnalysis).toHaveBeenCalledWith({
      cwd: '/project',
      orgSlug: 'test-org',
      packagePaths: ['/project/package.json', '/project/package-lock.json'],
      reachabilityOptions: { depth: 5 },
      spinner: expect.any(Object),
      uploadManifests: true,
    })
    expect(mockOutput).toHaveBeenCalled()
  })

  it('handles supported files fetch failure', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { outputScanReach } = await import('./output-scan-reach.mts')

    const mockFetchSupported = vi.mocked(fetchSupportedScanFileNames)
    const mockOutput = vi.mocked(outputScanReach)

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
    })
  })

  it('handles no eligible files found', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { checkCommandInput } = await import(
      '../../utils/validation/check-input.mts'
    )
    const { getPackageFilesForScan } = await import(
      '../../utils/fs/path-resolve.mjs'
    )

    const mockFetchSupported = vi.mocked(fetchSupportedScanFileNames)
    const mockCheckInput = vi.mocked(checkCommandInput)
    const mockGetPackageFiles = vi.mocked(getPackageFilesForScan)

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
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { outputScanReach } = await import('./output-scan-reach.mts')
    const { performReachabilityAnalysis } = await import(
      './perform-reachability-analysis.mts'
    )
    const { checkCommandInput } = await import(
      '../../utils/validation/check-input.mts'
    )
    const { getPackageFilesForScan } = await import(
      '../../utils/fs/path-resolve.mjs'
    )

    const mockFetchSupported = vi.mocked(fetchSupportedScanFileNames)
    const mockOutput = vi.mocked(outputScanReach)
    const mockPerformAnalysis = vi.mocked(performReachabilityAnalysis)
    const mockCheckInput = vi.mocked(checkCommandInput)
    const mockGetPackageFiles = vi.mocked(getPackageFilesForScan)

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
    })
  })
})
