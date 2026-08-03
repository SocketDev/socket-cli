/**
 * Unit tests for the MCP `depscore` tool implementation.
 *
 * Tests runDepscore(input, opts) — the worker behind the only MCP tool `socket
 * mcp` exposes. Covers SDK setup caching, payload shaping (PURL conversion,
 * version cleanup), and the error paths Socket API returns (401/403/non-200,
 * empty, malformed).
 *
 * Test Coverage:
 *
 * - Input schema (TypeBox shape) is exported and validates correctly
 * - Tool name + description constants exposed for the MCP wire
 * - SDK is constructed once per token and reused
 * - SDK setup failure surfaces as `isError: true`
 * - PURL builder is invoked per-package (npm/pypi/golang/maven shapes)
 * - Caret/tilde stripped from version (^1.2.3 → 1.2.3)
 * - Default ecosystem is npm when caller omits
 * - Default version is 'unknown' when caller omits
 * - 401 → auth-failed message
 * - 403 → access-denied message
 * - Other non-2xx → generic error
 * - Network exception → "Error connecting to Socket API"
 * - Platform hint forwarded to deduplicateArtifacts
 *
 * Related Files:
 *
 * - Src/commands/mcp/depscore.mts - Implementation
 * - Src/commands/mcp/lib/purl.mts - PURL helper
 * - Src/commands/mcp/lib/artifacts.mts - Dedup helper
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEPSCORE_TOOL_DESCRIPTION,
  DEPSCORE_TOOL_NAME,
  DepscoreInputSchema,
  runDepscore,
} from '../../../../src/commands/mcp/depscore.mts'

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

function makeErr(status: number, message: string, cause?: string | undefined) {
  return {
    success: false as const,
    status,
    error: message,
    ...(cause ? { cause } : {}),
  }
}

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

describe('depscore tool constants', () => {
  it('exposes the canonical tool name', () => {
    expect(DEPSCORE_TOOL_NAME).toBe('depscore')
  })

  it('exposes a non-empty tool description', () => {
    expect(DEPSCORE_TOOL_DESCRIPTION).toContain('depscore')
    expect(DEPSCORE_TOOL_DESCRIPTION.length).toBeGreaterThan(50)
  })
})

describe('DepscoreInputSchema (TypeBox)', () => {
  it('is a JSON-Schema-shaped object', () => {
    const schema = DepscoreInputSchema as unknown as Record<string, unknown>
    expect(schema['type']).toBe('object')
    expect(schema['properties']).toBeDefined()
    const props = schema['properties'] as Record<string, unknown>
    expect(props['packages']).toBeDefined()
    expect(props['platform']).toBeDefined()
  })

  it('declares packages as required (no Optional wrapper)', () => {
    const schema = DepscoreInputSchema as unknown as Record<string, unknown>
    const required = schema['required'] as string[] | undefined
    expect(required).toContain('packages')
    expect(required).not.toContain('platform')
  })
})

describe('runDepscore — SDK setup', () => {
  it('returns isError when SDK setup fails', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: false,
      cause: 'no token',
      message: 'Auth Error',
    })
    const result = await runDepscore(
      { packages: [{ depname: 'lodash' }] },
      { apiToken: 'test_x' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('SDK setup failed: no token')
    expect(mockBatchPackageFetch).not.toHaveBeenCalled()
  })

  it('caches SDK clients per token (one setupSdk per distinct token)', async () => {
    mockBatchPackageFetch.mockResolvedValue(makeOk([]))
    await runDepscore(
      { packages: [{ depname: 'a' }] },
      { apiToken: 'test_token_1' },
    )
    await runDepscore(
      { packages: [{ depname: 'b' }] },
      { apiToken: 'test_token_1' },
    )
    expect(mockSetupSdk).toHaveBeenCalledTimes(1)
    await runDepscore(
      { packages: [{ depname: 'c' }] },
      { apiToken: 'test_token_2' },
    )
    expect(mockSetupSdk).toHaveBeenCalledTimes(2)
  })
})

describe('runDepscore — payload shaping', () => {
  beforeEach(() => {
    mockBatchPackageFetch.mockResolvedValue(makeOk([]))
  })

  it('builds a PURL per package and calls batchPackageFetch with the components shape', async () => {
    await runDepscore(
      {
        packages: [
          { depname: 'lodash', ecosystem: 'npm', version: '4.17.21' },
          { depname: 'requests', ecosystem: 'pypi', version: '2.31.0' },
        ],
      },
      { apiToken: 'test_a' },
    )
    expect(mockBatchPackageFetch).toHaveBeenCalledTimes(1)
    const [arg, query] = mockBatchPackageFetch.mock.calls[0]
    expect(arg.components).toHaveLength(2)
    expect(arg.components[0].purl).toBe('pkg:npm/lodash@4.17.21')
    expect(arg.components[1].purl).toBe('pkg:pypi/requests@2.31.0')
    expect(query).toMatchObject({
      alerts: false,
      compact: false,
      fixable: false,
      licenseattrib: false,
      licensedetails: false,
    })
  })

  it('strips ^ and ~ from versions before building the PURL', async () => {
    await runDepscore(
      { packages: [{ depname: 'foo', ecosystem: 'npm', version: '^1.2.3' }] },
      { apiToken: 'test_a' },
    )
    const purl = mockBatchPackageFetch.mock.calls[0][0].components[0].purl
    expect(purl).toBe('pkg:npm/foo@1.2.3')
  })

  it('strips tilde ranges too', async () => {
    await runDepscore(
      { packages: [{ depname: 'foo', ecosystem: 'npm', version: '~1.2.3' }] },
      { apiToken: 'test_a' },
    )
    const purl = mockBatchPackageFetch.mock.calls[0][0].components[0].purl
    expect(purl).toBe('pkg:npm/foo@1.2.3')
  })

  it('defaults ecosystem to npm when caller omits it', async () => {
    await runDepscore(
      { packages: [{ depname: 'noeco' }] },
      { apiToken: 'test_a' },
    )
    const purl = mockBatchPackageFetch.mock.calls[0][0].components[0].purl
    expect(purl).toContain('pkg:npm/noeco')
  })

  it('defaults version to unknown when caller omits it', async () => {
    await runDepscore(
      { packages: [{ depname: 'unknownversion' }] },
      { apiToken: 'test_a' },
    )
    const purl = mockBatchPackageFetch.mock.calls[0][0].components[0].purl
    // 'unknown' sentinel → no @<version> in the PURL.
    expect(purl).toBe('pkg:npm/unknownversion')
  })
})

describe('runDepscore — error paths', () => {
  it('surfaces a 401 with a re-authenticate message', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeErr(401, 'Unauthorized', 'invalid token'),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_bad' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      'Socket authentication failed [401]',
    )
  })

  it('surfaces a 403 with a permissions message', async () => {
    mockBatchPackageFetch.mockResolvedValue(
      makeErr(403, 'Forbidden', 'missing scope'),
    )
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_locked' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Socket denied access [403]')
  })

  it('surfaces a generic non-2xx with the status code', async () => {
    mockBatchPackageFetch.mockResolvedValue(makeErr(503, 'Service Unavailable'))
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('[503]')
  })

  it('catches network exceptions from the SDK call', async () => {
    mockBatchPackageFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Error connecting to Socket API')
  })
})

describe('runDepscore — SDK setup error fallback chain', () => {
  it('uses result.message when result.cause is empty', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: false,
      cause: '',
      message: 'Auth Error',
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      // Distinct token per test so the module-scoped sdkCache doesn't
      // hit a previously-set fixture and skip the setup branch.
      { apiToken: 'test_setup_message_only' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Auth Error')
  })

  it('uses the hard-coded fallback string when both cause and message are empty', async () => {
    mockSetupSdk.mockResolvedValueOnce({
      ok: false,
      cause: '',
      message: '',
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_setup_full_fallback' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Failed to set up Socket SDK')
  })

  it('uses String(e) when SDK setup throws a non-Error value', async () => {
    mockSetupSdk.mockRejectedValueOnce('plain string')
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_setup_string_throw' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('SDK setup failed: plain string')
  })
})

describe('runDepscore — batchPackageFetch non-Error throw', () => {
  it('coerces non-Error rejections via String() in the network catch', async () => {
    mockBatchPackageFetch.mockRejectedValueOnce({ weird: 'object' })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Error connecting to Socket API')
  })
})

describe('runDepscore — non-success without cause/error fields', () => {
  it('uses empty string when 401 response has no cause and no error', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: false,
      status: 401,
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    // The trailing `${cause ?? ''}` becomes empty; assert the message
    // shape.
    expect(result.content[0].text).toMatch(
      /Socket authentication failed \[401\]\. Re-authenticate and retry\.\s*$/,
    )
  })

  it('uses empty string when 403 response has no cause and no error', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: false,
      status: 403,
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Re-authenticate.*retry\.\s*$/)
  })

  it('handles non-2xx response with no cause/error gracefully', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: false,
      status: 502,
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('[502]')
  })
})

describe('runDepscore — empty data field on success', () => {
  it('treats response.data === undefined as no packages', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: true,
      status: 200,
      data: undefined,
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('No packages were found.')
  })
})

describe('runDepscore — error fallbacks (cause vs error field)', () => {
  it('uses response.error when response.cause is absent on 401', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: false,
      status: 401,
      error: 'Bad token',
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      'Socket authentication failed [401]',
    )
    expect(result.content[0].text).toContain('Bad token')
  })

  it('uses response.error when response.cause is absent on 403', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: false,
      status: 403,
      error: 'No scope',
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Socket denied access [403]')
    expect(result.content[0].text).toContain('No scope')
  })

  it('uses response.error when response.cause is absent on a generic non-2xx', async () => {
    mockBatchPackageFetch.mockResolvedValue({
      success: false,
      status: 500,
      error: 'Internal Server Error',
    })
    const result = await runDepscore(
      { packages: [{ depname: 'foo' }] },
      { apiToken: 'test_a' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('[500]')
    expect(result.content[0].text).toContain('Internal Server Error')
  })
})

describe('runDepscore — platform hint forwarding', () => {
  it('forwards the platform hint to artifact dedup', async () => {
    // Two artifacts of the same package with different platforms.
    mockBatchPackageFetch.mockResolvedValue(
      makeOk([
        {
          type: 'pypi',
          name: 'numpy',
          version: '1.26.0',
          release: 'numpy-1.26.0-cp310-manylinux_x86_64.whl',
          score: { overall: 0.9, quality: 0.9 },
        },
        {
          type: 'pypi',
          name: 'numpy',
          version: '1.26.0',
          release: 'numpy-1.26.0-cp310-macosx_arm64.whl',
          score: { overall: 0.95, quality: 0.95 },
        },
      ]),
    )
    const result = await runDepscore(
      {
        packages: [{ depname: 'numpy', ecosystem: 'pypi', version: '1.26.0' }],
        platform: 'darwin-arm64',
      },
      { apiToken: 'test_a' },
    )
    // After dedup with darwin-arm64 hint, only the macosx wheel survives,
    // so the score line uses the higher number from that artifact.
    expect(result.content[0].text).toContain('quality: 95')
    expect(result.content[0].text).not.toContain('quality: 90')
  })
})
