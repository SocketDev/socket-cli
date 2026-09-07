/**
 * Unit tests for handleCreateNewScan's resolved-paths sidecar threading.
 *
 * Purpose: Under --auto-manifest with reachability enabled, the fan-out runs
 * with the sidecar switched on and its resolved-paths result reaches
 * performReachabilityAnalysis unchanged.
 *
 * Testing Approach: Mocks fetch and output functions to isolate handler
 * orchestration logic.
 *
 * Related Files: - src/commands/scan/handle-create-new-scan.mts
 * (implementation) - test/unit/commands/scan/handle-create-new-scan.test.mts,
 * core flow - test/unit/commands/scan/handle-create-new-scan-features.test.mts,
 * reachability, report, workspace, basics.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSuccessResult } from '../../../helpers/mocks.mts'
import { handleCreateNewScan } from '../../../../src/commands/scan/handle-create-new-scan.mts'

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
  import('../../../../src/commands/scan/fetch-create-org-full-scan.mts'),
  () => ({
    fetchCreateOrgFullScan: mockFetchCreateOrgFullScan,
  }),
)
vi.mock(
  import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts'),
  () => ({
    fetchSupportedScanFileNames: mockFetchSupportedScanFileNames,
  }),
)
vi.mock(
  import('../../../../src/commands/scan/finalize-tier1-scan.mts'),
  () => ({
    finalizeTier1Scan: mockFinalizeTier1Scan,
  }),
)
vi.mock(import('../../../../src/commands/scan/handle-scan-report.mts'), () => ({
  handleScanReport: mockHandleScanReport,
}))
vi.mock(
  import('../../../../src/commands/scan/output-create-new-scan.mts'),
  () => ({
    outputCreateNewScan: mockOutputCreateNewScan,
  }),
)
vi.mock(
  import('../../../../src/commands/scan/perform-reachability-analysis.mts'),
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
  import('../../../../src/commands/manifest/detect-manifest-actions.mts'),
  () => ({
    detectManifestActions: mockDetectManifestActions,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/generate_auto_manifest.mts'),
  () => ({
    generateAutoManifest: mockGenerateAutoManifest,
  }),
)

const mockRunSocketBasics = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/basics/spawn.mts'), () => ({
  runSocketBasics: mockRunSocketBasics,
}))

const mockSafeDelete = vi.hoisted(() => vi.fn())
// Mock the post-success facts deletion so no real fs delete runs.
vi.mock(import('@socketsecurity/lib-stable/fs/safe'), async importOriginal => ({
  ...(await importOriginal()),
  safeDelete: mockSafeDelete,
}))

describe('handleCreateNewScan sidecar threading', () => {
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

  it('threads the auto-manifest sidecar into reachability', async () => {
    const sidecar = [
      {
        // oxlint-disable-next-line socket/prefer-undefined-over-null -- frozen sidecar contract serializes an explicit JSON null
        classifier: null,
        ext: 'jar',
        group: 'org.example',
        name: 'lib',
        sources: [],
        targets: ['/test/project/libs/lib.jar'],
        version: '1.0.0',
      },
    ]
    mockReadOrDefaultSocketJson.mockReturnValue({})
    mockDetectManifestActions.mockResolvedValue({ gradle: true })
    mockGenerateAutoManifest.mockResolvedValue({
      generatedFiles: [],
      resolvedPathsSidecar: sidecar,
    })
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
      autoManifest: true,
      reach: {
        excludePaths: [],
        reachExcludePaths: [],
        runReachabilityAnalysis: true,
      },
    })

    // The fan-out ran with the sidecar switched on and its result reached
    // the coana invocation.
    expect(mockGenerateAutoManifest).toHaveBeenCalledWith(
      expect.objectContaining({ computeArtifactsSidecar: true }),
    )
    expect(mockPerformReachabilityAnalysis).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ resolvedPathsSidecar: sidecar }),
    )
  })
})
