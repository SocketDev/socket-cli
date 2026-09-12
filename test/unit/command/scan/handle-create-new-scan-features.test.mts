/**
 * Unit tests for handleCreateNewScan.
 *
 * Purpose: Tests the handler that orchestrates creating new security scans.
 * Covers reachability analysis, scan report generation, and workspace
 * targeting.
 *
 * Testing Approach: Mocks fetch and output functions to isolate handler
 * orchestration logic. Validates proper data flow through the handler
 * pipeline.
 *
 * Related Files: - src/command/handleCreateNewScan.mts (implementation) -
 * test/unit/command/scan/handle-create-new-scan.test.mts, core flow.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleCreateNewScan } from '../../../../src/command/scan/handle-create-new-scan.mts'

// Mock all the dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockFetchCreateOrgFullScan = vi.hoisted(() => vi.fn())
const mockFetchSupportedScanFileNames = vi.hoisted(() => vi.fn())
const mockFinalizeTier1Scan = vi.hoisted(() => vi.fn())
const mockHandleScanReport = vi.hoisted(() => vi.fn())
const mockOutputCreateNewScan = vi.hoisted(() => vi.fn())
const mockPerformReachabilityAnalysis = vi.hoisted(() => vi.fn())
const mockStart = vi.hoisted(() => vi.fn())
const mockStop = vi.hoisted(() => vi.fn())
const mockSuccessAndStop = vi.hoisted(() => vi.fn())
const mockCheckCommandInput = vi.hoisted(() => vi.fn())
const mockGetPackageFilesForScan = vi.hoisted(() => vi.fn())
const mockReadOrDefaultSocketJson = vi.hoisted(() => vi.fn())
const mockSocketDocsLink = vi.hoisted(() => vi.fn())
const mockDetectManifestActions = vi.hoisted(() => vi.fn())
const mockGenerateAutoManifest = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))
vi.mock(import('@socketsecurity/lib-stable/words/pluralize'), () => ({
  pluralize: vi.fn((word, count) => (count === 1 ? word : `${word}s`)),
}))
vi.mock(
  import('../../../../src/command/scan/fetch-create-org-full-scan.mts'),
  () => ({
    fetchCreateOrgFullScan: mockFetchCreateOrgFullScan,
  }),
)
vi.mock(
  import('../../../../src/command/scan/fetch-supported-scan-file-names.mts'),
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)
vi.mock(import('../../../../src/command/scan/finalize-tier1-scan.mts'), () => ({
  finalizeTier1Scan: mockFinalizeTier1Scan,
}))
vi.mock(import('../../../../src/command/scan/handle-scan-report.mts'), () => ({
  handleScanReport: mockHandleScanReport,
}))
vi.mock(
  import('../../../../src/command/scan/output-create-new-scan.mts'),
  () => ({
    outputCreateNewScan: mockOutputCreateNewScan,
  }),
)
vi.mock(
  import('../../../../src/command/scan/perform-reachability-analysis.mts'),
  () => ({
    performReachabilityAnalysis: mockPerformReachabilityAnalysis,
  }),
)
vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: () => ({
    start: mockStart,
    stop: mockStop,
    successAndStop: mockSuccessAndStop,
  }),
}))
vi.mock(import('../../../../src/util/validation/check-input.mts'), () => ({
  checkCommandInput: mockCheckCommandInput,
}))
vi.mock(import('../../../../src/util/fs/path-resolve.mts'), () => ({
  getPackageFilesForScan: mockGetPackageFilesForScan,
}))
vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))
vi.mock(import('../../../../src/util/terminal/link.mts'), () => ({
  socketDocsLink: mockSocketDocsLink,
}))
vi.mock(
  import('../../../../src/command/manifest/detect-manifest-actions.mts'),
  () => ({
    detectManifestActions: mockDetectManifestActions,
  }),
)
vi.mock(
  import('../../../../src/command/manifest/generate_auto_manifest.mts'),
  () => ({
    generateAutoManifest: mockGenerateAutoManifest,
  }),
)

describe('handleCreateNewScan', () => {
  const mockConfig = {
    autoManifest: false,
    branchName: 'main',
    commitHash: 'abc123',
    commitMessage: 'test commit',
    committers: 'user@example.com',
    cwd: '/test/project',
    defaultBranch: true,
    interactive: false,
    orgSlug: 'test-org',
    pendingHead: false,
    pullRequest: 0,
    outputKind: 'json' as const,
    reach: {
      excludePaths: [],
      reachExcludePaths: [],
      runReachabilityAnalysis: false,
    },
    readOnly: false,
    repoName: 'test-repo',
    report: false,
    reportLevel: 'error' as const,
    targets: ['.'],
    tmp: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles reachability analysis', async () => {
    const { fetchSupportedScanFileNames: _fetchSupportedScanFileNames } =
      await import('../../../../src/command/scan/fetch-supported-scan-file-names.mts')
    const { getPackageFilesForScan: _getPackageFilesForScan } =
      await import('../../../../src/util/fs/path-resolve.mts')
    await import('../../../../src/util/validation/check-input.mts')
    await import('../../../../src/command/scan/fetch-create-org-full-scan.mts')
    const { finalizeTier1Scan } =
      await import('../../../../src/command/scan/finalize-tier1-scan.mts')

    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)
    mockPerformReachabilityAnalysis.mockResolvedValue(
      createSuccessResult({
        reachabilityReport: '/test/project/.socket.facts.json',
        tier1ReachabilityScanId: 'tier1-scan-456',
      }),
    )
    mockFetchCreateOrgFullScan.mockResolvedValue(
      createSuccessResult({ id: 'scan-789' }),
    )

    await handleCreateNewScan({
      ...mockConfig,
      reach: {
        excludePaths: [],
        reachExcludePaths: [],
        runReachabilityAnalysis: true,
      },
    })

    expect(mockPerformReachabilityAnalysis).toHaveBeenCalled()
    expect(mockFetchCreateOrgFullScan).toHaveBeenCalledWith(
      ['/test/project/package.json', '/test/project/.socket.facts.json'],
      'test-org',
      expect.any(Object),
      expect.any(Object),
    )
    expect(finalizeTier1Scan).toHaveBeenCalledWith('tier1-scan-456', 'scan-789')
  })

  it('handles scan report generation', async () => {
    await import('../../../../src/command/scan/fetch-supported-scan-file-names.mts')
    await import('../../../../src/util/fs/path-resolve.mts')
    await import('../../../../src/util/validation/check-input.mts')
    await import('../../../../src/command/scan/fetch-create-org-full-scan.mts')
    const { handleScanReport } =
      await import('../../../../src/command/scan/handle-scan-report.mts')

    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)
    mockFetchCreateOrgFullScan.mockResolvedValue(
      createSuccessResult({ id: 'scan-report-123' }),
    )

    await handleCreateNewScan({ ...mockConfig, report: true })

    expect(handleScanReport).toHaveBeenCalledWith({
      filepath: '-',
      fold: 'version',
      includeLicensePolicy: true,
      orgSlug: 'test-org',
      outputKind: 'json',
      reportLevel: 'error',
      scanId: 'scan-report-123',
      short: false,
    })
  })

  it('handles reachability analysis failure', async () => {
    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)
    mockPerformReachabilityAnalysis.mockResolvedValue(
      createErrorResult('Reachability failed'),
    )

    await handleCreateNewScan({
      ...mockConfig,
      reach: {
        excludePaths: [],
        reachExcludePaths: [],
        runReachabilityAnalysis: true,
      },
    })

    expect(mockOutputCreateNewScan).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      {
        interactive: false,
        outputKind: 'json',
      },
    )
  })

  it('fails when first target is falsy with reachability enabled (line 215-216)', async () => {
    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)

    await handleCreateNewScan({
      ...mockConfig,
      reach: {
        excludePaths: [],
        reachExcludePaths: [],
        runReachabilityAnalysis: true,
      },
      // Array length=1 but the first element is empty string (falsy).
      targets: [''],
    })

    expect(mockPerformReachabilityAnalysis).not.toHaveBeenCalled()
    expect(mockFetchCreateOrgFullScan).not.toHaveBeenCalled()
  })

  it('handles report mode with missing scan ID', async () => {
    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)
    // Return success but without id.
    mockFetchCreateOrgFullScan.mockResolvedValue(
      createSuccessResult({ name: 'scan' }),
    )

    await handleCreateNewScan({ ...mockConfig, report: true })

    expect(mockOutputCreateNewScan).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: 'Missing Scan ID',
      }),
      { interactive: false, outputKind: 'json' },
    )
  })

  it('handles workspace parameter', async () => {
    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)
    mockFetchCreateOrgFullScan.mockResolvedValue(
      createSuccessResult({ id: 'scan-123' }),
    )

    await handleCreateNewScan({
      ...mockConfig,
      workspace: 'my-workspace',
    })

    expect(mockFetchCreateOrgFullScan).toHaveBeenCalledWith(
      expect.any(Array),
      'test-org',
      expect.objectContaining({
        workspace: 'my-workspace',
      }),
      expect.any(Object),
    )
  })
})
