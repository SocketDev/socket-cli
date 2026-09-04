/**
 * Regression tests for performReachabilityAnalysis facts-file resolution.
 *
 * Test Coverage:
 * - When the scan `cwd` differs from `process.cwd()` (e.g. the
 *   `--cwd <dir>` flag), the full application reachability scan id must be read from the
 *   facts file Coana actually wrote at `<cwd>/.socket.facts.json`, not from a
 *   relative path resolved against `process.cwd()`.
 * - Coana is never spawned without `--manifests-tar-hash`; a missing hash is a
 *   hard failure rather than a silent fall back to Docker mode.
 *
 * Related Files:
 * - perform-reachability-analysis.mts (implementation)
 * - utils/coana.mts (extractTier1ReachabilityScanId — exercised for real)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'

// The manifest upload is mandatory, so every call below runs through it and
// gets this tar hash back.
const TEST_ORG_SLUG = 'test-org'
const TEST_PACKAGE_PATHS = ['package.json']
const TEST_TAR_HASH = 'test-tar-hash'

const {
  mockFetchOrganization,
  mockHandleApiCall,
  mockHasEnterpriseOrgPlan,
  mockSetupSdk,
  mockSpawnCoanaDlx,
} = vi.hoisted(() => ({
  mockFetchOrganization: vi.fn(),
  mockHandleApiCall: vi.fn(async () => ({
    ok: true,
    data: { tarHash: 'test-tar-hash' },
  })),
  mockHasEnterpriseOrgPlan: vi.fn(),
  mockSetupSdk: vi.fn(async () => ({
    ok: true,
    data: { uploadManifestFiles: vi.fn() },
  })),
  mockSpawnCoanaDlx: vi.fn(),
}))

vi.mock('../organization/fetch-organization-list.mts', () => ({
  fetchOrganization: mockFetchOrganization,
}))

vi.mock('../../utils/organization.mts', () => ({
  hasEnterpriseOrgPlan: mockHasEnterpriseOrgPlan,
}))

vi.mock('../../utils/dlx.mts', () => ({
  spawnCoanaDlx: mockSpawnCoanaDlx,
}))

// Stubbed to keep the heavy SDK / API import chains out of the test.
vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

vi.mock('../../utils/api.mts', () => ({
  handleApiCall: mockHandleApiCall,
}))

vi.mock('../../utils/terminal-link.mts', () => ({
  socketDevLink: vi.fn((text: string) => text),
}))

vi.mock('../../constants.mts', () => ({
  default: {
    DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
    ENV: { INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION: 'test' },
    HTTP_STATUS_UNAUTHORIZED: 401,
    SOCKET_DEFAULT_BRANCH: 'socket-default-branch',
    SOCKET_DEFAULT_REPOSITORY: 'socket-default-repository',
  },
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

function makeReachabilityOptions(): ReachabilityOptions {
  return {
    dynamicSbomInference: false,
    excludePaths: [],
    reachAnalysisMemoryLimit: '',
    reachAnalysisTimeout: '',
    reachConcurrency: 0,
    reachContinueOnAnalysisErrors: false,
    reachContinueOnInstallErrors: false,
    reachContinueOnMissingLockFiles: false,
    reachContinueOnNoSourceFiles: false,
    reachDebug: false,
    reachDetailedAnalysisLogFile: false,
    reachDisableExternalToolChecks: false,
    reachDisableAnalytics: false,
    reachEcosystems: [],
    reachEnableAnalysisSplitting: false,
    reachExcludePaths: [],
    reachRetainFactsFile: false,
    reachSkipCache: false,
    reachUseOnlyPregeneratedSboms: false,
    reachVersion: undefined,
  }
}

describe('performReachabilityAnalysis facts-file resolution', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: '' })
    // A scan cwd that is intentionally NOT process.cwd().
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-rea495-'))
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  it('extracts the full application reachability scan id from the facts file under the scan cwd, not process.cwd()', async () => {
    // Coana (mocked) is spawned with `cwd`, so it writes the facts file under
    // the scan cwd. Pre-write it here to stand in for that output.
    writeFileSync(
      path.join(scanCwd, '.socket.facts.json'),
      JSON.stringify({ tier1ReachabilityScanId: 'reach-scan-rea495' }),
    )

    expect(scanCwd).not.toBe(process.cwd())

    const result = await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(mockSpawnCoanaDlx).toHaveBeenCalledTimes(1)
    // The Coana spawn must use the scan cwd so its write and our read agree.
    expect(mockSpawnCoanaDlx.mock.calls[0]![2]).toMatchObject({ cwd: scanCwd })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.tier1ReachabilityScanId).toBe(
      'reach-scan-rea495',
    )
    // The returned report path stays cwd-relative for upload / unlink.
    expect(result.ok && result.data.reachabilityReport).toBe(
      '.socket.facts.json',
    )
  })

  it('returns undefined full application reachability scan id when the facts file under cwd has none', async () => {
    writeFileSync(
      path.join(scanCwd, '.socket.facts.json'),
      JSON.stringify({ components: [] }),
    )

    const result = await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.tier1ReachabilityScanId).toBeUndefined()
  })
})

describe('performReachabilityAnalysis manifests tar hash', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: '' })
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-reatar-'))
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  it('always passes the uploaded tar hash and --run-without-docker to Coana', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('--run-without-docker')
    expect(args[args.indexOf('--manifests-tar-hash') + 1]).toBe(TEST_TAR_HASH)
  })

  it('fails without spawning Coana when the upload returns no tar hash', async () => {
    mockHandleApiCall.mockResolvedValueOnce({ ok: true, data: {} } as never)

    const result = await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(result.ok).toBe(false)
    expect(mockSpawnCoanaDlx).not.toHaveBeenCalled()
  })
})

describe('performReachabilityAnalysis timeout/memory forwarding', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: '' })
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-reaf-'))
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  async function coanaArgsFor(
    overrides: Partial<ReachabilityOptions>,
  ): Promise<string[]> {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: { ...makeReachabilityOptions(), ...overrides },
      target: scanCwd,
    })
    return mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
  }

  it('forwards unit-bearing values to Coana verbatim', async () => {
    const args = await coanaArgsFor({
      reachAnalysisTimeout: '90s',
      reachAnalysisMemoryLimit: '8GB',
    })
    expect(args).toContain('--analysis-timeout')
    expect(args[args.indexOf('--analysis-timeout') + 1]).toBe('90s')
    expect(args).toContain('--memory-limit')
    expect(args[args.indexOf('--memory-limit') + 1]).toBe('8GB')
  })

  it('omits both flags for empty values so Coana applies its defaults', async () => {
    const args = await coanaArgsFor({
      reachAnalysisTimeout: '',
      reachAnalysisMemoryLimit: '',
    })
    expect(args).not.toContain('--analysis-timeout')
    expect(args).not.toContain('--memory-limit')
  })

  it('omits flags for zero-magnitude values (back-compat sentinel)', async () => {
    const args = await coanaArgsFor({
      reachAnalysisTimeout: '0',
      reachAnalysisMemoryLimit: '0',
    })
    expect(args).not.toContain('--analysis-timeout')
    expect(args).not.toContain('--memory-limit')
  })
})

describe('performReachabilityAnalysis --maven-use-only-socket-facts gating', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: '' })
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-reamvomsf-'))
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  it('writes an empty sidecar and still passes both flags when dynamicSbomInference is on but no build root produced one (e.g. none found, or all empty/disabled)', async () => {
    let sidecarContentAtSpawnTime: unknown
    mockSpawnCoanaDlx.mockImplementationOnce(async (args: string[]) => {
      const sidecarPath = args[args.indexOf('--compute-artifacts-sidecar') + 1]!
      sidecarContentAtSpawnTime = JSON.parse(readFileSync(sidecarPath, 'utf8'))
      return { ok: true, data: '' }
    })

    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: {
        ...makeReachabilityOptions(),
        dynamicSbomInference: true,
      },
      resolvedPathsSidecar: undefined,
      target: scanCwd,
    })

    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('--maven-use-only-socket-facts')
    expect(args).toContain('--compute-artifacts-sidecar')
    expect(sidecarContentAtSpawnTime).toEqual({})
  })

  it('passes --maven-use-only-socket-facts alongside --compute-artifacts-sidecar when dynamicSbomInference is on and a sidecar was generated', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: {
        ...makeReachabilityOptions(),
        dynamicSbomInference: true,
      },
      resolvedPathsSidecar: {
        '/repo/reactor/.socket.facts.json': {
          components: [],
          projects: [],
        },
      },
      target: scanCwd,
    })

    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).toContain('--maven-use-only-socket-facts')
    expect(args).toContain('--compute-artifacts-sidecar')
  })

  it('never passes --maven-use-only-socket-facts when dynamicSbomInference is off, even if a sidecar happens to be present', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: {
        ...makeReachabilityOptions(),
        dynamicSbomInference: false,
      },
      resolvedPathsSidecar: {
        '/repo/reactor/.socket.facts.json': {
          components: [],
          projects: [],
        },
      },
      target: scanCwd,
    })

    const args = mockSpawnCoanaDlx.mock.calls[0]![0] as string[]
    expect(args).not.toContain('--maven-use-only-socket-facts')
    expect(args).toContain('--compute-artifacts-sidecar')
  })
})

describe('performReachabilityAnalysis stdio routing by output kind', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoanaDlx.mockResolvedValue({ ok: true, data: '' })
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-rea-stdio-'))
    writeFileSync(
      path.join(scanCwd, '.socket.facts.json'),
      JSON.stringify({ components: [] }),
    )
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  it('inherits stdio in text output mode', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      outputKind: 'text',
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(mockSpawnCoanaDlx.mock.calls[0]![2]).toMatchObject({
      stdio: 'inherit',
    })
  })

  it('defaults to inheriting stdio when no output kind is given', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(mockSpawnCoanaDlx.mock.calls[0]![2]).toMatchObject({
      stdio: 'inherit',
    })
  })

  it('redirects Coana stdout to stderr (fd 2) in json output mode', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      outputKind: 'json',
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(mockSpawnCoanaDlx.mock.calls[0]![2]).toMatchObject({
      stdio: ['inherit', 2, 'inherit'],
    })
  })

  it('redirects Coana stdout to stderr (fd 2) in markdown output mode', async () => {
    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      outputKind: 'markdown',
      packagePaths: TEST_PACKAGE_PATHS,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(mockSpawnCoanaDlx.mock.calls[0]![2]).toMatchObject({
      stdio: ['inherit', 2, 'inherit'],
    })
  })
})
