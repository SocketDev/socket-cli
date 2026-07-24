/**
 * Unit tests for performReachabilityAnalysis.
 *
 * Orchestrates: org-plan check → optional manifest upload → spawn Coana via dlx
 * → extract scan-id from output. Heavy on conditionals (every reachability flag
 * becomes a Coana CLI arg).
 *
 * Test Coverage:
 *
 * - 401 from fetchOrganization → "Authentication failed"
 * - Other fetchOrganization failure → "Unable to verify plan permissions"
 * - Non-enterprise plan → "requires an enterprise plan"
 * - Enterprise plan → proceeds
 * - Absolute target normalized to relative cwd-relative path
 * - Empty target relative-resolves to '.'
 * - UploadManifests=false skips the manifest upload
 * - UploadManifests=true with orgSlug+packagePaths runs upload
 * - .socket.facts.json filtered out of upload list
 * - SDK setup failure short-circuits with the SDK error
 * - Upload failure surfaces the upload error
 * - Missing tarHash in upload response → error
 * - Default repo name / branch name suppressed from coana env
 * - Custom repo name → SOCKET_REPO_NAME exported
 * - Custom branch name → SOCKET_BRANCH_NAME exported
 *
 * Related Files:
 *
 * - Src/commands/scan/perform-reachability-analysis.mts - Implementation
 * - Test/unit/commands/scan/perform-reachability-analysis-coana.test.mts - Coana
 *   flag forwarding, machine-output mode, and result handling
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

const enterpriseOrgs = {
  data: {
    organizations: [
      { id: 'a', slug: 'ent', name: 'Ent', image: '', plan: 'enterprise' },
    ],
  },
  ok: true as const,
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
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
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
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
    const idx = args.indexOf('run')
    expect(args[idx + 1]).toBe('.')
  })

  it('keeps a relative target unchanged', async () => {
    await performReachabilityAnalysis({
      cwd: '/work',
      reachabilityOptions: baseReachOpts,
      target: 'sub/dir',
    })
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
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
    const args = mockSpawnCoanaDlx.mock.calls[0][0] as string[]
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
    const apiCallSpec = mockHandleApiCall.mock.calls[0][0]
    // The first arg to handleApiCall is the SDK promise; we just want
    // to confirm uploadManifestFiles was given the filtered list.
    expect(mockUploadManifestFiles).toHaveBeenCalledTimes(1)
    const [, filepaths] = mockUploadManifestFiles.mock.calls[0]
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
    const callOpts = mockSpawnCoanaDlx.mock.calls[0][2]
    expect(callOpts.env['SOCKET_REPO_NAME']).toBeUndefined()
  })

  it('exports SOCKET_REPO_NAME for non-default repo names', async () => {
    await performReachabilityAnalysis({
      reachabilityOptions: baseReachOpts,
      repoName: 'my-repo',
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0][2]
    expect(callOpts.env['SOCKET_REPO_NAME']).toBe('my-repo')
  })

  it('omits SOCKET_BRANCH_NAME when branch is the default', async () => {
    await performReachabilityAnalysis({
      branchName: 'socket-default-branch',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0][2]
    expect(callOpts.env['SOCKET_BRANCH_NAME']).toBeUndefined()
  })

  it('exports SOCKET_BRANCH_NAME for non-default branch names', async () => {
    await performReachabilityAnalysis({
      branchName: 'feat/x',
      reachabilityOptions: baseReachOpts,
      target: '.',
    })
    const callOpts = mockSpawnCoanaDlx.mock.calls[0][2]
    expect(callOpts.env['SOCKET_BRANCH_NAME']).toBe('feat/x')
  })
})
