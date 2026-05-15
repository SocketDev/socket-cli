/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for performReachabilityAnalysis.
 *
 * Orchestrates: org-plan check → optional manifest upload → spawn
 * Coana via dlx → extract scan-id from output. Heavy on conditionals
 * (every reachability flag becomes a Coana CLI arg).
 *
 * Test Coverage:
 * - 401 from fetchOrganization → "Authentication failed"
 * - Other fetchOrganization failure → "Unable to verify plan permissions"
 * - Non-enterprise plan → "requires an enterprise plan"
 * - Enterprise plan → proceeds
 * - Absolute target normalized to relative cwd-relative path
 * - Empty target relative-resolves to '.'
 * - uploadManifests=false skips the manifest upload
 * - uploadManifests=true with orgSlug+packagePaths runs upload
 * - .socket.facts.json filtered out of upload list
 * - SDK setup failure short-circuits with the SDK error
 * - Upload failure surfaces the upload error
 * - Missing tarHash in upload response → error
 * - Default repo name / branch name suppressed from coana env
 * - Custom repo name → SOCKET_REPO_NAME exported
 * - Custom branch name → SOCKET_BRANCH_NAME exported
 * - Every reachability flag → matching --flag in coana args
 * - Empty reachEcosystems → no --purl-types
 * - Machine mode adds --silent and stdio: 'ignore'
 * - Coana failure logs error and returns the failure CResult
 * - Coana success extracts scan ID from outputFilePath
 * - Custom outputPath wins over DOT_SOCKET_DOT_FACTS_JSON
 *
 * Related Files:
 * - src/commands/scan/perform-reachability-analysis.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger'

const {
  mockExtractTier1ReachabilityScanId,
  mockFetchOrganization,
  mockGetMachineOutputMode,
  mockHandleApiCall,
  mockHasEnterpriseOrgPlan,
  mockSetupSdk,
  mockSocketDevLink,
  mockSpawnCoanaDlx,
  mockUploadManifestFiles,
} = vi.hoisted(() => ({
  mockExtractTier1ReachabilityScanId: vi.fn(),
  mockFetchOrganization: vi.fn(),
  mockGetMachineOutputMode: vi.fn(),
  mockHandleApiCall: vi.fn(),
  mockHasEnterpriseOrgPlan: vi.fn(),
  mockSetupSdk: vi.fn(),
  mockSocketDevLink: vi.fn((label: string, _path: string) => `[link:${label}]`),
  mockSpawnCoanaDlx: vi.fn(),
  mockUploadManifestFiles: vi.fn(),
}))

vi.mock('../../../../src/constants/paths.mts', () => ({
  DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
}))

vi.mock(
  '../../../../src/commands/organization/fetch-organization-list.mts',
  () => ({
    fetchOrganization: mockFetchOrganization,
  }),
)

vi.mock('../../../../src/utils/coana/extract-scan-id.mjs', () => ({
  extractTier1ReachabilityScanId: mockExtractTier1ReachabilityScanId,
}))

vi.mock('../../../../src/utils/dlx/spawn.mjs', () => ({
  spawnCoanaDlx: mockSpawnCoanaDlx,
}))

vi.mock('../../../../src/utils/output/ambient-mode.mts', () => ({
  getMachineOutputMode: mockGetMachineOutputMode,
}))

vi.mock('../../../../src/utils/organization.mts', () => ({
  hasEnterpriseOrgPlan: mockHasEnterpriseOrgPlan,
}))

vi.mock('../../../../src/utils/socket/api.mjs', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('../../../../src/utils/terminal/link.mts', () => ({
  socketDevLink: mockSocketDevLink,
}))

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof LoggerModule>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

const { performReachabilityAnalysis } =
  await import('../../../../src/commands/scan/perform-reachability-analysis.mts')

const enterpriseOrgs = {
  ok: true as const,
  data: {
    organizations: [
      { id: 'a', slug: 'ent', name: 'Ent', image: '', plan: 'enterprise' },
    ],
  },
}

const baseReachOpts = {
  excludePaths: [],
  reachAnalysisMemoryLimit: 0,
  reachAnalysisTimeout: 0,
  reachConcurrency: 0,
  reachDebug: false,
  reachDetailedAnalysisLogFile: false,
  reachDisableAnalytics: false,
  reachDisableExternalToolChecks: false,
  reachEnableAnalysisSplitting: false,
  reachEcosystems: [],
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
  mockFetchOrganization.mockResolvedValue(enterpriseOrgs)
  mockHasEnterpriseOrgPlan.mockReturnValue(true)
  mockGetMachineOutputMode.mockReturnValue(false)
  mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: undefined })
  mockExtractTier1ReachabilityScanId.mockReturnValue('scan-abc')
})

describe('performReachabilityAnalysis — plan checks', () => {
  it('returns "Authentication failed" on a 401 from fetchOrganization', async () => {
    mockFetchOrganization.mockResolvedValueOnce({
      ok: false,
      message: 'Unauthorized',
      data: { code: 401 },
    })
    const result = await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Authentication failed')
    }
  })

  it('returns generic plan error on other fetch failures', async () => {
    mockFetchOrganization.mockResolvedValueOnce({
      ok: false,
      message: 'API down',
    })
    const result = await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Unable to verify plan permissions')
    }
  })

  it('rejects non-enterprise plans with an upgrade link', async () => {
    mockHasEnterpriseOrgPlan.mockReturnValue(false)
    const result = await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('enterprise plan')
    }
    expect(mockSocketDevLink).toHaveBeenCalled()
  })
})

describe('performReachabilityAnalysis — target normalization', () => {
  it('relativizes an absolute target to the cwd', async () => {
    await performReachabilityAnalysis({
      cwd: '/work',
      reachabilityOptions: baseReachOpts,
      target: '/work/sub',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    // Coana args includes 'run' followed by the relativized target.
    const idx = args.indexOf('run')
    expect(args[idx + 1]).toBe('sub')
  })

  it('uses "." when relative resolution would produce empty string', async () => {
    await performReachabilityAnalysis({
      cwd: '/work',
      reachabilityOptions: baseReachOpts,
      target: '/work',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    const idx = args.indexOf('run')
    expect(args[idx + 1]).toBe('.')
  })

  it('keeps a relative target unchanged', async () => {
    await performReachabilityAnalysis({
      cwd: '/work',
      reachabilityOptions: baseReachOpts,
      target: 'sub/dir',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    const idx = args.indexOf('run')
    expect(args[idx + 1]).toBe('sub/dir')
  })
})

describe('performReachabilityAnalysis — manifest upload', () => {
  it('skips upload when uploadManifests is false', async () => {
    await performReachabilityAnalysis({
      orgSlug: 'ent',
      packagePaths: ['pkg/package.json'],
      reachabilityOptions: baseReachOpts,
      target: '.',
      uploadManifests: false,
    })
    expect(mockSetupSdk).not.toHaveBeenCalled()
    expect(mockHandleApiCall).not.toHaveBeenCalled()
  })

  it('skips upload when orgSlug is missing', async () => {
    await performReachabilityAnalysis({
      packagePaths: ['pkg/package.json'],
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(mockSetupSdk).not.toHaveBeenCalled()
  })

  it('skips upload when packagePaths is missing', async () => {
    await performReachabilityAnalysis({
      orgSlug: 'ent',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(mockSetupSdk).not.toHaveBeenCalled()
  })

  it('runs upload when orgSlug + packagePaths + uploadManifests', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: true,
      data: { uploadManifestFiles: mockUploadManifestFiles },
    })
    mockHandleApiCall.mockResolvedValueOnce({
      ok: true,
      data: { tarHash: 'abc123' },
    })
    const result = await performReachabilityAnalysis({
      orgSlug: 'ent',
      packagePaths: ['pkg/package.json'],
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(mockSetupSdk).toHaveBeenCalled()
    expect(mockHandleApiCall).toHaveBeenCalled()
    // Coana args include the tar hash flags.
    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('--manifests-tar-hash')
    expect(args).toContain('abc123')
    expect(result.ok).toBe(true)
  })

  it('filters out .socket.facts.json paths from upload list', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: true,
      data: { uploadManifestFiles: mockUploadManifestFiles },
    })
    mockHandleApiCall.mockResolvedValueOnce({
      ok: true,
      data: { tarHash: 'abc123' },
    })
    await performReachabilityAnalysis({
      orgSlug: 'ent',
      packagePaths: [
        'pkg/package.json',
        'sub/.socket.facts.json',
        'pkg/.socket.facts.json',
      ],
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const apiCallSpec = mockHandleApiCall.mock.calls[0]![0]
    // The first arg to handleApiCall is the SDK promise; we just want
    // to confirm uploadManifestFiles was given the filtered list.
    expect(mockUploadManifestFiles).toHaveBeenCalledTimes(1)
    const [, filepaths] = mockUploadManifestFiles.mock.calls[0]!
    expect(filepaths).toEqual(['pkg/package.json'])
  })

  it('returns the SDK setup error when setupSdk fails', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: false,
      message: 'Auth Error',
      cause: 'no token',
    })
    const result = await performReachabilityAnalysis({
      orgSlug: 'ent',
      packagePaths: ['pkg/package.json'],
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Auth Error')
    }
    expect(mockHandleApiCall).not.toHaveBeenCalled()
  })

  it('returns the upload error when uploadManifestFiles fails', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: true,
      data: { uploadManifestFiles: mockUploadManifestFiles },
    })
    mockHandleApiCall.mockResolvedValueOnce({
      ok: false,
      message: 'Upload failed',
    })
    const result = await performReachabilityAnalysis({
      orgSlug: 'ent',
      packagePaths: ['pkg/package.json'],
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Upload failed')
    }
    expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
  })

  it('errors when the upload response is missing tarHash', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: true,
      data: { uploadManifestFiles: mockUploadManifestFiles },
    })
    mockHandleApiCall.mockResolvedValueOnce({
      ok: true,
      data: {},
    })
    const result = await performReachabilityAnalysis({
      orgSlug: 'ent',
      packagePaths: ['pkg/package.json'],
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('tar hash')
    }
  })
})

describe('performReachabilityAnalysis — repo and branch env', () => {
  it('omits SOCKET_REPO_NAME when repo is the default', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      repoName: 'socket-default-repository',
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0]![2]
    expect(callOpts.env['SOCKET_REPO_NAME']).toBeUndefined()
  })

  it('exports SOCKET_REPO_NAME for non-default repo names', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      repoName: 'my-repo',
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0]![2]
    expect(callOpts.env['SOCKET_REPO_NAME']).toBe('my-repo')
  })

  it('omits SOCKET_BRANCH_NAME when branch is the default', async () => {
    await performReachabilityAnalysis({
      branchName: 'socket-default-branch',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0]![2]
    expect(callOpts.env['SOCKET_BRANCH_NAME']).toBeUndefined()
  })

  it('exports SOCKET_BRANCH_NAME for non-default branch names', async () => {
    await performReachabilityAnalysis({
      branchName: 'feat/x',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0]![2]
    expect(callOpts.env['SOCKET_BRANCH_NAME']).toBe('feat/x')
  })
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
