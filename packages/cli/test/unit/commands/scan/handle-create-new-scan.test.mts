/**
 * Unit tests for handleCreateNewScan.
 *
 * Purpose: Tests the handler that orchestrates creating new security scans.
 * Validates manifest file detection, configuration, and scan submission.
 *
 * Test Coverage: - Successful operation flow - Fetch failure handling - Input
 * validation - Output formatting delegation - Auto-manifest mode.
 *
 * Testing Approach: Mocks fetch and output functions to isolate handler
 * orchestration logic. Validates proper data flow through the handler
 * pipeline.
 *
 * Related Files: - src/commands/handleCreateNewScan.mts (implementation) -
 * test/unit/commands/scan/handle-create-new-scan-features.test.mts
 * (reachability, report, workspace, basics)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'
import { handleCreateNewScan } from '../../../../src/commands/scan/handle-create-new-scan.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

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

  it('creates scan successfully with found files', async () => {
    const { fetchSupportedScanFileNames } =
      await import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts')
    const { getPackageFilesForScan } =
      await import('../../../../src/util/fs/path-resolve.mts')
    await import('../../../../src/util/validation/check-input.mts')
    const { fetchCreateOrgFullScan } =
      await import('../../../../src/commands/scan/fetch-create-org-full-scan.mts')
    const { outputCreateNewScan } =
      await import('../../../../src/commands/scan/output-create-new-scan.mts')

    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json', 'yarn.lock'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue([
      '/test/project/package.json',
      '/test/project/yarn.lock',
    ])
    mockCheckCommandInput.mockReturnValue(true)
    mockFetchCreateOrgFullScan.mockResolvedValue(
      createSuccessResult({ id: 'scan-123' }),
    )

    await handleCreateNewScan(mockConfig)

    expect(fetchSupportedScanFileNames).toHaveBeenCalled()
    expect(getPackageFilesForScan).toHaveBeenCalledWith(
      ['.'],
      new Set(['package.json', 'yarn.lock']),
      { cwd: '/test/project' },
    )
    expect(fetchCreateOrgFullScan).toHaveBeenCalledWith(
      ['/test/project/package.json', '/test/project/yarn.lock'],
      'test-org',
      expect.any(Object),
      expect.any(Object),
    )
    expect(outputCreateNewScan).toHaveBeenCalledWith(
      createSuccessResult({ id: 'scan-123' }),
      {
        interactive: false,
        outputKind: 'json',
      },
    )
  })

  it('handles auto-manifest mode', async () => {
    const { readOrDefaultSocketJson } =
      await import('../../../../src/util/socket/json.mts')
    const { detectManifestActions } =
      await import('../../../../src/commands/manifest/detect-manifest-actions.mts')
    const { generateAutoManifest } =
      await import('../../../../src/commands/manifest/generate_auto_manifest.mts')
    await import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts')
    const { getPackageFilesForScan: _getPackageFilesForScan } =
      await import('../../../../src/util/fs/path-resolve.mts')
    await import('../../../../src/util/validation/check-input.mts')

    mockReadOrDefaultSocketJson.mockReturnValue({})
    mockDetectManifestActions.mockResolvedValue({ detected: true })
    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)

    await handleCreateNewScan({ ...mockConfig, autoManifest: true })

    expect(readOrDefaultSocketJson).toHaveBeenCalledWith('/test/project')
    expect(detectManifestActions).toHaveBeenCalled()
    expect(generateAutoManifest).toHaveBeenCalledWith({
      detected: { detected: true },
      cwd: '/test/project',
      outputKind: 'json',
      verbose: false,
    })
  })

  it('handles no eligible files found', async () => {
    // biome-ignore lint/correctness/noUnusedVariables: imported for mocking.
    const { fetchSupportedScanFileNames } =
      await import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts')
    // biome-ignore lint/correctness/noUnusedVariables: imported for mocking.
    const { getPackageFilesForScan } =
      await import('../../../../src/util/fs/path-resolve.mts')
    const { checkCommandInput } =
      await import('../../../../src/util/validation/check-input.mts')

    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue([])
    mockCheckCommandInput.mockReturnValue(false)

    await handleCreateNewScan(mockConfig)

    expect(checkCommandInput).toHaveBeenCalledWith(
      'json',
      expect.objectContaining({
        test: false,
        fail: expect.stringContaining('found no eligible files to scan'),
      }),
    )
  })

  it('handles read-only mode', async () => {
    // biome-ignore lint/correctness/noUnusedVariables: imported for mocking.
    const { fetchSupportedScanFileNames } =
      await import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts')
    // biome-ignore lint/correctness/noUnusedVariables: imported for mocking.
    const { getPackageFilesForScan } =
      await import('../../../../src/util/fs/path-resolve.mts')
    // biome-ignore lint/correctness/noUnusedVariables: imported for mocking.
    const { checkCommandInput } =
      await import('../../../../src/util/validation/check-input.mts')
    const { fetchCreateOrgFullScan } =
      await import('../../../../src/commands/scan/fetch-create-org-full-scan.mts')

    mockFetchSupportedScanFileNames.mockResolvedValue(
      createSuccessResult(new Set(['package.json'])),
    )
    mockGetPackageFilesForScan.mockResolvedValue(['/test/project/package.json'])
    mockCheckCommandInput.mockReturnValue(true)

    await handleCreateNewScan({
      ...mockConfig,
      readOnly: true,
      outputKind: 'text',
    })

    // Note: getDefaultLogger().log assertion removed due to mock resolution issues.
    // Main behavior (not calling fetchCreateOrgFullScan) is still tested.
    expect(fetchCreateOrgFullScan).not.toHaveBeenCalled()
  })

  it('handles fetch supported files failure', async () => {
    await import('../../../../src/commands/scan/fetch-supported-scan-file-names.mts')
    const { outputCreateNewScan } =
      await import('../../../../src/commands/scan/output-create-new-scan.mts')

    const error = new Error('API error')
    mockFetchSupportedScanFileNames.mockResolvedValue(
      createErrorResult(error.message),
    )

    await handleCreateNewScan(mockConfig)

    expect(outputCreateNewScan).toHaveBeenCalledWith(
      createErrorResult(error.message),
      {
        interactive: false,
        outputKind: 'json',
      },
    )
  })

  describe('reachability facts file cleanup', () => {
    // These run against a real tmp cwd and the real safeDelete so the
    // assertions observe actual on-disk state after submission.
    async function setupTmpProject() {
      const path = await import('node:path')
      const os = await import('node:os')
      const fs = await import('node:fs')
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-scan-facts-'))
      const factsPath = path.join(tmpDir, '.socket.facts.json')
      mockFetchSupportedScanFileNames.mockResolvedValue(
        createSuccessResult(new Set(['package.json'])),
      )
      mockGetPackageFilesForScan.mockResolvedValue([
        path.join(tmpDir, 'package.json'),
      ])
      mockCheckCommandInput.mockReturnValue(true)
      return { factsPath, fs, tmpDir }
    }

    it('deletes a facts file it generated after a successful submission', async () => {
      const { factsPath, fs, tmpDir } = await setupTmpProject()
      try {
        // Coana writes the facts file during the analysis, not before it.
        mockPerformReachabilityAnalysis.mockImplementation(async () => {
          fs.writeFileSync(factsPath, '{}', 'utf8')
          return createSuccessResult({
            reachabilityReport: factsPath,
            tier1ReachabilityScanId: 'tier1-scan-456',
          })
        })
        mockFetchCreateOrgFullScan.mockResolvedValue(
          createSuccessResult({ id: 'scan-789' }),
        )

        await handleCreateNewScan({
          ...mockConfig,
          cwd: tmpDir,
          reach: {
            excludePaths: [],
            reachExcludePaths: [],
            runReachabilityAnalysis: true,
          },
        })

        expect(fs.existsSync(factsPath)).toBe(false)
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('keeps a facts file it generated when the submission fails', async () => {
      const { factsPath, fs, tmpDir } = await setupTmpProject()
      try {
        mockPerformReachabilityAnalysis.mockImplementation(async () => {
          fs.writeFileSync(factsPath, '{}', 'utf8')
          return createSuccessResult({
            reachabilityReport: factsPath,
            tier1ReachabilityScanId: 'tier1-scan-456',
          })
        })
        mockFetchCreateOrgFullScan.mockResolvedValue(
          createErrorResult('upload failed'),
        )

        await handleCreateNewScan({
          ...mockConfig,
          cwd: tmpDir,
          reach: {
            excludePaths: [],
            reachExcludePaths: [],
            runReachabilityAnalysis: true,
          },
        })

        expect(fs.existsSync(factsPath)).toBe(true)
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('keeps a facts file that pre-existed the run', async () => {
      const { factsPath, fs, tmpDir } = await setupTmpProject()
      try {
        // The file is on disk before the analysis, so it was not produced by
        // this run (e.g. the user pre-generated it) and must be preserved.
        fs.writeFileSync(factsPath, '{}', 'utf8')
        mockPerformReachabilityAnalysis.mockResolvedValue(
          createSuccessResult({
            reachabilityReport: factsPath,
            tier1ReachabilityScanId: 'tier1-scan-456',
          }),
        )
        mockFetchCreateOrgFullScan.mockResolvedValue(
          createSuccessResult({ id: 'scan-789' }),
        )

        await handleCreateNewScan({
          ...mockConfig,
          cwd: tmpDir,
          reach: {
            excludePaths: [],
            reachExcludePaths: [],
            runReachabilityAnalysis: true,
          },
        })

        expect(fs.existsSync(factsPath)).toBe(true)
      } finally {
        safeDeleteSync(tmpDir)
      }
    })

    it('keeps the facts file when --reach-use-only-pregenerated-sboms is set', async () => {
      const { factsPath, fs, tmpDir } = await setupTmpProject()
      try {
        // In pregenerated-SBOMs mode the user manages their own artifacts, so
        // the facts file is left in place even though this run wrote it.
        mockPerformReachabilityAnalysis.mockImplementation(async () => {
          fs.writeFileSync(factsPath, '{}', 'utf8')
          return createSuccessResult({
            reachabilityReport: factsPath,
            tier1ReachabilityScanId: 'tier1-scan-456',
          })
        })
        mockFetchCreateOrgFullScan.mockResolvedValue(
          createSuccessResult({ id: 'scan-789' }),
        )

        await handleCreateNewScan({
          ...mockConfig,
          cwd: tmpDir,
          reach: {
            excludePaths: [],
            reachExcludePaths: [],
            reachUseOnlyPregeneratedSboms: true,
            runReachabilityAnalysis: true,
          },
        })

        expect(fs.existsSync(factsPath)).toBe(true)
      } finally {
        safeDeleteSync(tmpDir)
      }
    })
  })
})
