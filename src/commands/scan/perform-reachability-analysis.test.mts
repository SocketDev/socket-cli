/**
 * Regression tests for performReachabilityAnalysis facts-file resolution.
 *
 * Test Coverage:
 * - When the scan `cwd` differs from `process.cwd()` (e.g. the
 *   `--cwd <dir>` flag), the tier 1 reachability scan id must be read from the
 *   facts file Coana actually wrote at `<cwd>/.socket.facts.json`, not from a
 *   relative path resolved against `process.cwd()`.
 *
 * Related Files:
 * - perform-reachability-analysis.mts (implementation)
 * - utils/coana.mts (extractTier1ReachabilityScanId — exercised for real)
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'

const { mockFetchOrganization, mockHasEnterpriseOrgPlan, mockSpawnCoanaDlx } =
  vi.hoisted(() => ({
    mockFetchOrganization: vi.fn(),
    mockHasEnterpriseOrgPlan: vi.fn(),
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

// Stubbed to keep the heavy SDK / API import chains out of the test; the
// happy path below skips the manifest-upload branch entirely.
vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

vi.mock('../../utils/api.mts', () => ({
  handleApiCall: vi.fn(),
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
    excludePaths: [],
    reachAnalysisMemoryLimit: 0,
    reachAnalysisTimeout: 0,
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
    reachLazyMode: false,
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

  it('extracts the tier 1 scan id from the facts file under the scan cwd, not process.cwd()', async () => {
    // Coana (mocked) is spawned with `cwd`, so it writes the facts file under
    // the scan cwd. Pre-write it here to stand in for that output.
    writeFileSync(
      path.join(scanCwd, '.socket.facts.json'),
      JSON.stringify({ tier1ReachabilityScanId: 'reach-scan-rea495' }),
    )

    expect(scanCwd).not.toBe(process.cwd())

    const result = await performReachabilityAnalysis({
      cwd: scanCwd,
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

  it('returns undefined tier 1 scan id when the facts file under cwd has none', async () => {
    writeFileSync(
      path.join(scanCwd, '.socket.facts.json'),
      JSON.stringify({ components: [] }),
    )

    const result = await performReachabilityAnalysis({
      cwd: scanCwd,
      reachabilityOptions: makeReachabilityOptions(),
      target: scanCwd,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.tier1ReachabilityScanId).toBeUndefined()
  })
})
