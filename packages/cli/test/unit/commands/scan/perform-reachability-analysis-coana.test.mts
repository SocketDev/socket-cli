/**
 * Unit tests for performReachabilityAnalysis.
 *
 * Orchestrates: org-plan check → optional manifest upload → spawn Coana via dlx
 * → extract scan-id from output. Heavy on conditionals (every reachability flag
 * becomes a Coana CLI arg).
 *
 * Test Coverage:
 *
 * - Every reachability flag → matching --flag in coana args
 * - Empty reachEcosystems → no --purl-types
 * - Machine mode adds --silent and stdio: 'ignore'
 * - Coana failure logs error and returns the failure CResult
 * - Coana success extracts scan ID from outputFilePath
 * - Custom outputPath wins over DOT_SOCKET_DOT_FACTS_JSON
 *
 * Related Files:
 *
 * - Src/commands/scan/perform-reachability-analysis.mts - Implementation
 * - Test/unit/commands/scan/perform-reachability-analysis.test.mts - Plan checks,
 *   target normalization, manifest upload, and repo/branch env
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { performReachabilityAnalysis } from '../../../../src/commands/scan/perform-reachability-analysis.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'

const {
  mockExtractTier1ReachabilityScanId,
  mockFetchOrganization,
  mockGetMachineOutputMode,
  mockHandleApiCall,
  mockHasEnterpriseOrgPlan,
  mockSetupSdk,
  mockSocketDevLink,
  mockSpawnCoanaDlx,
} = vi.hoisted(() => ({
  mockExtractTier1ReachabilityScanId: vi.fn(),
  mockFetchOrganization: vi.fn(),
  mockGetMachineOutputMode: vi.fn(),
  mockHandleApiCall: vi.fn(),
  mockHasEnterpriseOrgPlan: vi.fn(),
  mockSetupSdk: vi.fn(),
  mockSocketDevLink: vi.fn((label: string, _path: string) => `[link:${label}]`),
  mockSpawnCoanaDlx: vi.fn(),
}))

vi.mock(import('../../../../src/constants/paths.mts'), () => ({
  DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
}))

vi.mock(
  import('../../../../src/commands/organization/fetch-organization-list.mts'),
  () => ({
    fetchOrganization: mockFetchOrganization,
  }),
)

vi.mock(import('../../../../src/util/coana/extract-scan-id.mjs'), () => ({
  extractTier1ReachabilityScanId: mockExtractTier1ReachabilityScanId,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mjs'), () => ({
  spawnCoanaDlx: mockSpawnCoanaDlx,
}))

vi.mock(import('../../../../src/util/output/ambient-mode.mts'), () => ({
  getMachineOutputMode: mockGetMachineOutputMode,
}))

vi.mock(import('../../../../src/util/organization.mts'), () => ({
  hasEnterpriseOrgPlan: mockHasEnterpriseOrgPlan,
}))

vi.mock(import('../../../../src/util/socket/api.mjs'), () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock(import('../../../../src/util/socket/sdk.mjs'), () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock(import('../../../../src/util/terminal/link.mts'), () => ({
  socketDevLink: mockSocketDevLink,
}))

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

const baseReachOpts = {
  excludePaths: [],
  reachAnalysisMemoryLimit: 0,
  reachAnalysisTimeout: 0,
  reachConcurrency: 0,
  reachDebug: false,
  reachDetailedAnalysisLogFile: false,
  reachDisableAnalytics: false,
  reachDisableExternalToolChecks: false,
  reachEcosystems: [],
  reachEnableAnalysisSplitting: false,
  reachExcludePaths: [],
  reachLazyMode: false,
  reachMinSeverity: '',
  reachSkipCache: false,
  reachUseOnlyPregeneratedSboms: false,
  reachUseUnreachableFromPrecomputation: false,
  reachVersion: undefined,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchOrganization.mockResolvedValue({
    data: {
      organizations: [
        { id: 'a', slug: 'ent', name: 'Ent', image: '', plan: 'enterprise' },
      ],
    },
    ok: true as const,
  })
  mockHasEnterpriseOrgPlan.mockReturnValue(true)
  mockGetMachineOutputMode.mockReturnValue(false)
  mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: undefined })
  mockExtractTier1ReachabilityScanId.mockReturnValue('scan-abc')
})

describe('performReachabilityAnalysis — coana flag forwarding', () => {
  it('builds the base flag set (--disable-report-submission, --disable-analysis-splitting)', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('--disable-report-submission')
    expect(args).toContain('--disable-analysis-splitting')
    expect(args).toContain('--socket-mode')
  })

  it('forwards every reachability flag when set', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: {
        ...baseReachOpts,
        reachAnalysisMemoryLimit: 4096,
        reachAnalysisTimeout: 600,
        reachConcurrency: 4,
        reachDebug: true,
        reachDetailedAnalysisLogFile: true,
        reachDisableAnalytics: true,
        reachDisableExternalToolChecks: true,
        reachEcosystems: ['npm', 'pypi'],
        reachEnableAnalysisSplitting: true,
        reachExcludePaths: ['vendor/', 'node_modules/'],
        reachLazyMode: true,
        reachMinSeverity: 'high',
        reachSkipCache: true,
        reachUseOnlyPregeneratedSboms: true,
        reachUseUnreachableFromPrecomputation: true,
      },
      target: '.',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('--analysis-timeout')
    expect(args).toContain('600')
    expect(args).toContain('--memory-limit')
    expect(args).toContain('4096')
    expect(args).toContain('--concurrency')
    expect(args).toContain('4')
    expect(args).toContain('--debug')
    expect(args).toContain('--detailed-analysis-log-file')
    expect(args).toContain('--disable-analytics-sharing')
    expect(args).toContain('--disable-external-tool-checks')
    // analysis-splitting is INVERTED: enabled flag means we omit
    // --disable-analysis-splitting.
    expect(args).not.toContain('--disable-analysis-splitting')
    expect(args).toContain('--purl-types')
    expect(args).toContain('npm')
    expect(args).toContain('pypi')
    expect(args).toContain('--exclude-dirs')
    expect(args).toContain('vendor/')
    expect(args).toContain('--lazy-mode')
    expect(args).toContain('--min-severity')
    expect(args).toContain('high')
    expect(args).toContain('--skip-cache-usage')
    expect(args).toContain('--use-only-pregenerated-sboms')
    expect(args).toContain('--use-unreachable-from-precomputation')
  })

  it('omits --purl-types when reachEcosystems is empty', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).not.toContain('--purl-types')
  })

  it('omits --exclude-dirs when reachExcludePaths is empty', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).not.toContain('--exclude-dirs')
  })
})

describe('performReachabilityAnalysis — machine-output mode', () => {
  it('adds --silent and uses stdio: ignore in machine mode', async () => {
    mockGetMachineOutputMode.mockReturnValue(true)
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    const opts = mockSpawnCoanaDlx.mock.calls[0]![2]
    expect(args[0]).toBe('--silent')
    expect(opts.stdio).toBe('ignore')
  })

  it('keeps stdio: inherit in interactive mode', async () => {
    mockGetMachineOutputMode.mockReturnValue(false)
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const opts = mockSpawnCoanaDlx.mock.calls[0]![2]
    expect(opts.stdio).toBe('inherit')
  })
})

describe('performReachabilityAnalysis — coana result handling', () => {
  it('logs error and returns failure when coana fails', async () => {
    mockSpawnCoanaDlx.mockResolvedValueOnce({
      ok: false,
      message: 'coana crashed',
    })
    const result = await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Reachability analysis failed'),
    )
  })

  it('returns the report path + scan ID on success', async () => {
    mockExtractTier1ReachabilityScanId.mockReturnValue('scan-xyz')
    const result = await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.reachabilityReport).toBe('.socket.facts.json')
      expect(result.data.tier1ReachabilityScanId).toBe('scan-xyz')
    }
  })

  it('uses outputPath when provided', async () => {
    const result = await performReachabilityAnalysis({
      outputPath: '/custom/out.json',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    if (result.ok) {
      expect(result.data.reachabilityReport).toBe('/custom/out.json')
    }
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('/custom/out.json')
  })

  it('falls back to default outputPath when value is whitespace', async () => {
    const result = await performReachabilityAnalysis({
      outputPath: '   ',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    if (result.ok) {
      expect(result.data.reachabilityReport).toBe('.socket.facts.json')
    }
  })
})
