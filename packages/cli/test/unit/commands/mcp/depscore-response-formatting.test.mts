/**
 * Unit tests for the MCP `depscore` tool's response parsing and score
 * formatting.
 *
 * Tests runDepscore(input, opts) — the worker behind the only MCP tool `socket
 * mcp` exposes. Covers response parsing/formatting for successful Socket API
 * replies: NDJSON-shaped artifact parsing, PURL reconstruction for display,
 * score scaling (0-1 → 0-100), overall/uuid filtering, and the
 * formatScore fallbacks for missing type/name/version/score fields.
 *
 * Test Coverage:
 *
 * - 200 OK with NDJSON-shaped response → formatted "pkg: dim:N, …"
 * - 200 OK with empty data → "No packages were found." error
 * - 200 OK with only `_type` rows → "No valid artifact records" error
 * - Score formatting: numeric values ≤ 1 multiplied by 100 and rounded
 * - Score formatting: numeric values > 1 passed through
 * - Score formatting: `overall` and `uuid` keys filtered out
 * - Artifacts without score field → "No score found"
 * - Missing type/name/version fall back to the "unknown" placeholder
 *
 * Related Files:
 *
 * - Src/commands/mcp/depscore.mts - Implementation
 * - Src/commands/mcp/lib/purl.mts - PURL helper
 * - Src/commands/mcp/lib/artifacts.mts - Dedup helper
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runDepscore } from '../../../../src/commands/mcp/depscore.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
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

const { mockBatchPackageFetch, mockSetupSdk } = vi.hoisted(() => ({
  mockBatchPackageFetch: vi.fn(),
  mockSetupSdk: vi.fn(),
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  setupSdk: mockSetupSdk,
  getDefaultApiToken: vi.fn(() => 'test_fake_token'),
}))

function makeOk<T>(data: T) {
  return { success: true as const, status: 200, data }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: SDK setup succeeds with a fake client whose
  // batchPackageFetch returns the per-test fixture.
  mockSetupSdk.mockResolvedValue({
    ok: true,
    data: { batchPackageFetch: mockBatchPackageFetch },
  })
})

describe('runDepscore — response handling', () => {
  it('formats a single artifact with score breakdown', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        {
          type: 'npm',
          name: 'lodash',
          version: '4.17.21',
          score: {
            overall: 0.9,
            quality: 0.85,
            maintenance: 0.95,
          },
        },
      ]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'lodash' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('Dependency scores:')
    expect(result.content[0]!.text).toContain('pkg:npm/lodash@4.17.21')
    expect(result.content[0]!.text).toContain('quality: 85')
    expect(result.content[0]!.text).toContain('maintenance: 95')
  })

  it('omits overall and uuid from the score breakdown', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        {
          type: 'npm',
          name: 'foo',
          version: '1.0.0',
          score: { overall: 0.7, uuid: 'abc-def', supplyChain: 0.6 },
        },
      ]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.content[0]!.text).toContain('supplyChain: 60')
    expect(result.content[0]!.text).not.toContain('overall:')
    expect(result.content[0]!.text).not.toContain('uuid:')
  })

  it('passes numeric values >1 through as-is (no *100 scaling)', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        {
          type: 'npm',
          name: 'foo',
          version: '1.0.0',
          score: { overall: 95, quality: 87 },
        },
      ]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    // 87 already on 0–100 scale → not re-scaled.
    expect(result.content[0]!.text).toContain('quality: 87')
  })

  it('formats namespace into the PURL when present', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        {
          type: 'npm',
          namespace: '@scope',
          name: 'pkg',
          version: '1.0.0',
          score: { overall: 0.5, quality: 0.5 },
        },
      ]),
    )
    const result = await runDepscore(
      { packages: [{ depname: '@scope/pkg' }] },
      { apiToken: 'test_a' },
    )
    expect(result.content[0]!.text).toContain('pkg:npm/@scope/pkg@1.0.0')
  })

  it('returns "No score found" when artifact has no score field', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([{ type: 'npm', name: 'foo', version: '1.0.0' }]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.content[0]!.text).toContain('No score found')
  })

  it('drops `_type` envelope rows from the response', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        { _type: 'summary', count: 1 },
        {
          type: 'npm',
          name: 'foo',
          version: '1.0.0',
          score: { overall: 0.8, quality: 0.8 },
        },
      ]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('quality: 80')
  })

  it('returns an error when the response only has _type rows', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([{ _type: 'summary', count: 0 }]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('No valid artifact records')
  })

  it('returns "No packages were found." when data is empty', async () => {
    mockBatchPackageFetch.mockResolvedValue(makeOk([]))
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('No packages were found.')
  })
})

describe('runDepscore — formatScore fallbacks', () => {
  it('uses "unknown" placeholder for missing type / name / version', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        {
          // No type, no name, no version. score is empty so we land in
          // the "No score found" branch but still exercise the
          // type||'unknown', name||'unknown', version||'unknown' arms.
          score: undefined,
        },
      ]),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'whatever' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('pkg:unknown/unknown@unknown')
    expect(result.content[0]!.text).toContain('No score found')
  })
})
