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
 * - Resolved-paths sidecar → temp file + --compute-artifacts-sidecar, cleaned up
 *   after the run
 * - Machine mode adds --silent and routes coana stdout to stderr
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

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'

import path from 'node:path'

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
    await performReachabilityAnalysis('.', baseReachOpts)
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    expect(args).toContain('--disable-report-submission')
    expect(args).toContain('--disable-analysis-splitting')
    expect(args).toContain('--socket-mode')
  })

  it('forwards every reachability flag when set', async () => {
    await performReachabilityAnalysis('.', {
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
    })
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
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
    await performReachabilityAnalysis('.', baseReachOpts)
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    expect(args).not.toContain('--purl-types')
  })

  it('omits --exclude-dirs when reachExcludePaths is empty', async () => {
    await performReachabilityAnalysis('.', baseReachOpts)
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    expect(args).not.toContain('--exclude-dirs')
  })
})

describe('performReachabilityAnalysis — resolved-paths sidecar', () => {
  const sidecar = [
    {
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- frozen sidecar contract serializes an explicit JSON null
      classifier: null,
      ext: 'jar',
      group: 'org.example',
      name: 'lib',
      sources: [],
      targets: ['/proj/libs/lib.jar'],
      version: '1.0.0',
    },
  ]

  it('writes the sidecar to a temp file, passes the flag, and cleans up', async () => {
    let sidecarArgPath: string | undefined
    let contentAtSpawnTime: string | undefined
    mockSpawnCoanaDlx.mockImplementationOnce(async (args: string[]) => {
      const flagIndex = args.indexOf('--compute-artifacts-sidecar')
      sidecarArgPath = flagIndex === -1 ? undefined : args[flagIndex + 1]
      if (sidecarArgPath) {
        contentAtSpawnTime = readFileSync(sidecarArgPath, 'utf8')
      }
      return { ok: true, data: undefined }
    })

    await performReachabilityAnalysis('.', baseReachOpts, {
      resolvedPathsSidecar: sidecar,
    })

    expect(sidecarArgPath).toMatch(/socket-compute-artifacts-sidecar-.*\.json/)
    expect(sidecarArgPath).toContain(os.tmpdir())
    expect(contentAtSpawnTime).toBe(JSON.stringify(sidecar))
    // The temp file is cleaned up once the run finishes.
    expect(existsSync(sidecarArgPath!)).toBe(false)
  })

  it('cleans up the temp sidecar when coana fails', async () => {
    let sidecarArgPath: string | undefined
    mockSpawnCoanaDlx.mockImplementationOnce(async (args: string[]) => {
      const flagIndex = args.indexOf('--compute-artifacts-sidecar')
      sidecarArgPath = flagIndex === -1 ? undefined : args[flagIndex + 1]
      return { ok: false, message: 'coana crashed' }
    })

    const result = await performReachabilityAnalysis('.', baseReachOpts, {
      resolvedPathsSidecar: sidecar,
    })

    expect(result.ok).toBe(false)
    expect(sidecarArgPath).toBeDefined()
    expect(existsSync(sidecarArgPath!)).toBe(false)
  })

  it('omits --compute-artifacts-sidecar when no sidecar is provided', async () => {
    await performReachabilityAnalysis('.', baseReachOpts)
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    expect(args).not.toContain('--compute-artifacts-sidecar')
  })

  it('omits --compute-artifacts-sidecar for an empty sidecar', async () => {
    await performReachabilityAnalysis('.', baseReachOpts, {
      resolvedPathsSidecar: [],
    })
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    expect(args).not.toContain('--compute-artifacts-sidecar')
  })
})

describe('performReachabilityAnalysis — machine-output mode', () => {
  it('adds --silent and routes coana stdout to stderr in machine mode', async () => {
    mockGetMachineOutputMode.mockReturnValue(true)
    await performReachabilityAnalysis('.', baseReachOpts)
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    // Argument 1 is the CoanaDlxOptions bag that carries stdio. Argument 2 is
    // spawnExtra, which performReachabilityAnalysis never passes, so reading
    // it here threw instead of asserting.
    const opts = mockSpawnCoanaDlx.mock.calls[0][1]
    expect(args[0]).toBe('--silent')
    // Payload owns stdout; coana progress goes to fd 2 so it stays visible.
    expect(opts.stdio).toEqual(['inherit', 2, 'inherit'])
  })

  it('keeps stdio: inherit in interactive mode', async () => {
    mockGetMachineOutputMode.mockReturnValue(false)
    await performReachabilityAnalysis('.', baseReachOpts)
    const opts = mockSpawnCoanaDlx.mock.calls[0][1]
    expect(opts.stdio).toBe('inherit')
  })
})

describe('performReachabilityAnalysis — coana result handling', () => {
  it('logs error and returns failure when coana fails', async () => {
    mockSpawnCoanaDlx.mockResolvedValueOnce({
      ok: false,
      message: 'coana crashed',
    })
    const result = await performReachabilityAnalysis('.', baseReachOpts)
    expect(result.ok).toBe(false)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Reachability analysis failed'),
    )
  })

  it('returns the report path + scan ID on success', async () => {
    mockExtractTier1ReachabilityScanId.mockReturnValue('scan-xyz')
    const result = await performReachabilityAnalysis('.', baseReachOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.reachabilityReport).toBe('.socket.facts.json')
      expect(result.data.tier1ReachabilityScanId).toBe('scan-xyz')
    }
  })

  it('reads the facts file relative to the scan cwd, not process.cwd()', async () => {
    // Coana is spawned with `cwd`, so the facts file lands there. Resolving
    // the read against process.cwd() missed it under `--cwd <dir>` and the
    // tier 1 id came back undefined.
    mockExtractTier1ReachabilityScanId.mockReturnValue('scan-xyz')
    await performReachabilityAnalysis('.', baseReachOpts, {
      cwd: '/elsewhere/project',
    })
    expect(mockExtractTier1ReachabilityScanId).toHaveBeenCalledWith(
      path.resolve('/elsewhere/project', '.socket.facts.json'),
    )
  })

  it('uses outputPath when provided', async () => {
    const result = await performReachabilityAnalysis('.', baseReachOpts, {
      outputPath: '/custom/out.json',
    })
    if (result.ok) {
      expect(result.data.reachabilityReport).toBe('/custom/out.json')
    }
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    expect(args).toContain('/custom/out.json')
  })

  it('falls back to default outputPath when value is whitespace', async () => {
    const result = await performReachabilityAnalysis('.', baseReachOpts, {
      outputPath: '   ',
    })
    if (result.ok) {
      expect(result.data.reachabilityReport).toBe('.socket.facts.json')
    }
  })
})
