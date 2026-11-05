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
import { makeReachabilityOptions } from '../../../test/reachability-options.mts'

import type {
  ReachabilityAnalysisOptions,
  ReachabilityOptions,
} from './perform-reachability-analysis.mts'

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
  mockSpawnCoana,
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
  mockSpawnCoana: vi.fn(),
}))

vi.mock('../organization/fetch-organization-list.mts', () => ({
  fetchOrganization: mockFetchOrganization,
}))

vi.mock('../../utils/organization.mts', () => ({
  hasEnterpriseOrgPlan: mockHasEnterpriseOrgPlan,
}))

vi.mock('../../utils/coana-release.mts', () => ({
  spawnCoana: mockSpawnCoana,
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
  COANA_CLI_VERSION: 'test',
  default: {
    DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
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

describe('performReachabilityAnalysis facts-file resolution', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoana.mockResolvedValue({ ok: true, data: '' })
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

    expect(mockSpawnCoana).toHaveBeenCalledTimes(1)
    // The Coana spawn must use the scan cwd so its write and our read agree.
    expect(mockSpawnCoana.mock.calls[0]![2]).toMatchObject({ cwd: scanCwd })

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
    mockSpawnCoana.mockResolvedValue({ ok: true, data: '' })
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

    const args = mockSpawnCoana.mock.calls[0]![0] as string[]
    expect(args).toContain('--run-without-docker')
    expect(args[args.indexOf('--manifests-tar-hash') + 1]).toBe(TEST_TAR_HASH)
  })

  it('uploads build facts but not earlier reachability reports', async () => {
    const uploadManifestFiles = vi.fn()
    mockSetupSdk.mockResolvedValueOnce({
      ok: true,
      data: { uploadManifestFiles },
    })

    await performReachabilityAnalysis({
      cwd: scanCwd,
      orgSlug: TEST_ORG_SLUG,
      outputPath: 'out/report.json',
      packagePaths: [
        'package.json',
        'pom.xml.socket.facts.json',
        'gradle.socket.facts.json',
        '.socket.facts.json',
        'nested/.socket.facts.json',
        path.join(scanCwd, 'out/report.json'),
      ],
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(uploadManifestFiles.mock.calls[0]![1]).toEqual([
      'package.json',
      'pom.xml.socket.facts.json',
      'gradle.socket.facts.json',
    ])
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
    expect(mockSpawnCoana).not.toHaveBeenCalled()
  })
})

async function coanaArgsFor(
  cwd: string,
  reachabilityOptions: Partial<ReachabilityOptions>,
  options: Partial<ReachabilityAnalysisOptions> = {},
): Promise<string[]> {
  await performReachabilityAnalysis({
    cwd,
    orgSlug: TEST_ORG_SLUG,
    packagePaths: TEST_PACKAGE_PATHS,
    reachabilityOptions: {
      ...makeReachabilityOptions(),
      ...reachabilityOptions,
    },
    target: cwd,
    ...options,
  })
  return mockSpawnCoana.mock.calls[0]![0] as string[]
}

function factsOnlyArgs(args: string[]): string[] {
  return args.flatMap((arg, i) =>
    arg === '--maven-use-only-socket-facts'
      ? [arg]
      : arg === '--use-only-socket-facts-artifacts'
        ? [arg, args[i + 1]!]
        : [],
  )
}

describe('performReachabilityAnalysis flag forwarding', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoana.mockResolvedValue({ ok: true, data: '' })
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-reaf-'))
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  it('forwards unit-bearing values to Coana verbatim', async () => {
    const args = await coanaArgsFor(scanCwd, {
      reachAnalysisTimeout: '90s',
      reachAnalysisMemoryLimit: '8GB',
    })
    expect(args).toContain('--analysis-timeout')
    expect(args[args.indexOf('--analysis-timeout') + 1]).toBe('90s')
    expect(args).toContain('--memory-limit')
    expect(args[args.indexOf('--memory-limit') + 1]).toBe('8GB')
  })

  it('omits both flags for empty values so Coana applies its defaults', async () => {
    const args = await coanaArgsFor(scanCwd, {
      reachAnalysisTimeout: '',
      reachAnalysisMemoryLimit: '',
    })
    expect(args).not.toContain('--analysis-timeout')
    expect(args).not.toContain('--memory-limit')
  })

  it('omits flags for zero-magnitude values (back-compat sentinel)', async () => {
    const args = await coanaArgsFor(scanCwd, {
      reachAnalysisTimeout: '0',
      reachAnalysisMemoryLimit: '0',
    })
    expect(args).not.toContain('--analysis-timeout')
    expect(args).not.toContain('--memory-limit')
  })

  it('passes --reach-advisories to Coana as --ghsas', async () => {
    const args = await coanaArgsFor(scanCwd, {
      reachAdvisories: ['GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc'],
    })
    const ghsasIndex = args.indexOf('--ghsas')
    expect(args.slice(ghsasIndex + 1, ghsasIndex + 3)).toEqual([
      'GHSA-35jh-r3h4-6jhm',
      'GHSA-r5fr-rjxr-66jc',
    ])
  })

  it('omits --ghsas when no advisories are given', async () => {
    const args = await coanaArgsFor(scanCwd, { reachAdvisories: [] })
    expect(args).not.toContain('--ghsas')
  })
})

describe('performReachabilityAnalysis --use-only-socket-facts-artifacts gating', () => {
  let scanCwd: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: {} },
    })
    mockHasEnterpriseOrgPlan.mockReturnValue(true)
    mockSpawnCoana.mockResolvedValue({ ok: true, data: '' })
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-reamvomsf-'))
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
  })

  const sidecar = {
    '/repo/reactor/.socket.facts.json': { components: [], projects: [] },
  }

  it.for([
    {
      name: 'names every facts-only type next to the sidecar',
      factsOnlyTypes: ['maven', 'nuget'],
      resolvedPathsSidecar: sidecar,
      expected: ['--use-only-socket-facts-artifacts', 'maven,nuget'],
      expectedSidecar: sidecar,
    },
    {
      name: 'keeps the Maven-only flag older Coana releases know, with an empty sidecar',
      factsOnlyTypes: ['maven'],
      resolvedPathsSidecar: undefined,
      expected: ['--maven-use-only-socket-facts'],
      expectedSidecar: {},
    },
    {
      name: 'passes no facts-only flag without facts-only types, even with a sidecar',
      factsOnlyTypes: undefined,
      resolvedPathsSidecar: sidecar,
      expected: [],
      expectedSidecar: sidecar,
    },
  ] as const)(
    '$name',
    async ({
      expected,
      expectedSidecar,
      factsOnlyTypes,
      resolvedPathsSidecar,
    }) => {
      let sidecarAtSpawn: unknown
      mockSpawnCoana.mockImplementationOnce(async (args: string[]) => {
        const sidecarPath =
          args[args.indexOf('--compute-artifacts-sidecar') + 1]!
        sidecarAtSpawn = JSON.parse(readFileSync(sidecarPath, 'utf8'))
        return { ok: true, data: '' }
      })

      const args = await coanaArgsFor(
        scanCwd,
        {},
        { factsOnlyTypes, resolvedPathsSidecar },
      )

      expect(factsOnlyArgs(args)).toEqual(expected)
      expect(sidecarAtSpawn).toEqual(expectedSidecar)
    },
  )

  it('writes no sidecar without facts-only types or sidecar entries', async () => {
    const args = await coanaArgsFor(scanCwd, {
      dynamicSbomInference: ['maven', 'nuget'],
    })
    expect(args).not.toContain('--compute-artifacts-sidecar')
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
    mockSpawnCoana.mockResolvedValue({ ok: true, data: '' })
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

    expect(mockSpawnCoana.mock.calls[0]![2]).toMatchObject({
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

    expect(mockSpawnCoana.mock.calls[0]![2]).toMatchObject({
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

    expect(mockSpawnCoana.mock.calls[0]![2]).toMatchObject({
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

    expect(mockSpawnCoana.mock.calls[0]![2]).toMatchObject({
      stdio: ['inherit', 2, 'inherit'],
    })
  })
})
