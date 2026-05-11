/**
 * Unit tests for the MCP server factory.
 *
 * Tests createConfiguredServer(config) — wires the low-level SDK
 * `Server` class with two request handlers (tools/list, tools/call)
 * and the depscore tool. We test by directly invoking the registered
 * handlers via the SDK's `request()` method (which round-trips through
 * its internal validators).
 *
 * Test Coverage:
 * - Server identifies itself with the configured name + version
 * - Capabilities advertise tools{}
 * - tools/list returns exactly one tool (depscore) with the right
 *   metadata (name, description, inputSchema as plain JSON Schema,
 *   readOnlyHint annotation, title)
 * - tools/call dispatches to runDepscore and returns its result
 * - tools/call rejects unknown tool names with isError + message
 * - tools/call validates input via the TypeBox-compiled checker
 *   (rejects missing/wrong-typed `packages` field)
 * - tools/call uses the per-request OAuth token from extra.authInfo
 *   when present (HTTP+OAuth path)
 * - tools/call falls back to config.getApiToken() when authInfo is
 *   absent (stdio path)
 * - tools/call surfaces "Authentication is required." when no token
 *   is available from either source
 *
 * Testing approach
 * - Mock runDepscore so the test doesn't need a live SDK.
 * - Construct the real `Server`, retrieve its registered handlers via
 *   the SDK's protected map (or by calling it directly), assert on
 *   the result shape.
 *
 * Related Files:
 * - src/commands/mcp/server.mts - Implementation
 * - src/commands/mcp/depscore.mts - Tool worker (mocked here)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const { mockRunDepscore } = vi.hoisted(() => ({
  mockRunDepscore: vi.fn(),
}))

vi.mock('../../../../src/commands/mcp/depscore.mts', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/commands/mcp/depscore.mts')
    >()
  return {
    ...actual,
    runDepscore: mockRunDepscore,
  }
})

const { createConfiguredServer } =
  await import('../../../../src/commands/mcp/server.mts')

// Helper: invoke a handler from the underlying SDK Server. The SDK
// exposes `.setRequestHandler` but not a public `.handle(...)`, so we
// pull the registered handler off the internal `_requestHandlers` map.
type AnyServer = {
  _requestHandlers: Map<
    string,
    (req: unknown, extra: unknown) => Promise<unknown>
  >
}

export function getHandler(
  server: ReturnType<typeof createConfiguredServer>,
  schema: typeof ListToolsRequestSchema | typeof CallToolRequestSchema,
) {
  const internal = server as unknown as AnyServer
  const method = (schema as unknown as { shape: { method: { value: string } } })
    .shape.method.value
  const handler = internal._requestHandlers.get(method)
  if (!handler) {
    throw new Error(`No handler registered for ${method}`)
  }
  return handler
}

const baseConfig = {
  getApiToken: () => 'test_default_token',
  serverName: 'socket',
  version: '9.9.9',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRunDepscore.mockResolvedValue({
    content: [{ text: 'ok', type: 'text' as const }],
  })
})

describe('createConfiguredServer — construction', () => {
  it('creates a Server with the configured name and version', () => {
    const server = createConfiguredServer(baseConfig)
    // The SDK Server stores serverInfo internally; round-trip via the
    // protocol's getter for the server's implementation info.
    const info = (
      server as unknown as { _serverInfo: { name: string; version: string } }
    )._serverInfo
    expect(info.name).toBe('socket')
    expect(info.version).toBe('9.9.9')
  })

  it('declares the tools capability', () => {
    const server = createConfiguredServer(baseConfig)
    const caps = (
      server as unknown as { _capabilities: Record<string, unknown> }
    )._capabilities
    expect(caps['tools']).toBeDefined()
  })
})

describe('createConfiguredServer — tools/list handler', () => {
  it('returns the single depscore tool', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, ListToolsRequestSchema)
    const result = (await handler(
      { method: 'tools/list', params: {} },
      {},
    )) as {
      tools: Array<{
        name: string
        description: string
        title?: string
        annotations?: { readOnlyHint?: boolean }
        inputSchema: Record<string, unknown>
      }>
    }
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]!.name).toBe('depscore')
    expect(result.tools[0]!.title).toBe('Dependency Score Tool')
    expect(result.tools[0]!.annotations?.readOnlyHint).toBe(true)
    expect(result.tools[0]!.description).toContain('depscore')
  })

  it('emits a plain JSON Schema (no TypeBox symbols/keys)', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, ListToolsRequestSchema)
    const result = (await handler(
      { method: 'tools/list', params: {} },
      {},
    )) as { tools: Array<{ inputSchema: Record<string, unknown> }> }
    const schema = result.tools[0]!.inputSchema
    // Round-trippable through JSON.
    expect(() => JSON.parse(JSON.stringify(schema))).not.toThrow()
    // Has the expected shape.
    expect(schema['type']).toBe('object')
    expect(schema['properties']).toBeDefined()
    const props = schema['properties'] as Record<string, unknown>
    expect(props['packages']).toBeDefined()
    expect(props['platform']).toBeDefined()
    // No symbol-keyed TypeBox metadata.
    const ownKeys = Reflect.ownKeys(schema)
    const symbolKeys = ownKeys.filter(k => typeof k === 'symbol')
    expect(symbolKeys).toHaveLength(0)
  })
})

describe('createConfiguredServer — tools/call handler', () => {
  it('dispatches to runDepscore for the depscore tool', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: {
          name: 'depscore',
          arguments: { packages: [{ depname: 'lodash' }] },
        },
      },
      {},
    )) as { content: Array<{ text: string; type: string }>; isError?: boolean }
    expect(mockRunDepscore).toHaveBeenCalledTimes(1)
    expect(mockRunDepscore.mock.calls[0]![0]).toEqual({
      packages: [{ depname: 'lodash' }],
    })
    expect(result.content[0]!.text).toBe('ok')
    expect(result.isError).toBeUndefined()
  })

  it('returns isError when called with an unknown tool name', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: {
          name: 'unknown-tool',
          arguments: {},
        },
      },
      {},
    )) as { content: Array<{ text: string; type: string }>; isError?: boolean }
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Unknown tool: unknown-tool')
  })

  it('returns isError + validation message when arguments are missing the packages field', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: { name: 'depscore', arguments: {} },
      },
      {},
    )) as { content: Array<{ text: string; type: string }>; isError?: boolean }
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Invalid arguments for depscore')
  })

  it('returns isError when packages is the wrong shape (string instead of array)', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: { name: 'depscore', arguments: { packages: 'not-an-array' } },
      },
      {},
    )) as { content: Array<{ text: string; type: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Invalid arguments for depscore')
  })

  it('uses the OAuth token from extra.authInfo when present', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    await handler(
      {
        method: 'tools/call',
        params: {
          name: 'depscore',
          arguments: { packages: [{ depname: 'foo' }] },
        },
      },
      { authInfo: { token: 'oauth_user_token_xyz' } },
    )
    expect(mockRunDepscore).toHaveBeenCalledWith(
      expect.objectContaining({ packages: expect.any(Array) }),
      { apiToken: 'oauth_user_token_xyz' },
    )
  })

  it('falls back to config.getApiToken() when authInfo is absent', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    await handler(
      {
        method: 'tools/call',
        params: {
          name: 'depscore',
          arguments: { packages: [{ depname: 'foo' }] },
        },
      },
      {},
    )
    expect(mockRunDepscore).toHaveBeenCalledWith(
      expect.objectContaining({ packages: expect.any(Array) }),
      { apiToken: 'test_default_token' },
    )
  })

  it('surfaces the auth-required message when no token is available from either source', async () => {
    const server = createConfiguredServer({
      ...baseConfig,
      getApiToken: () => undefined,
    })
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: {
          name: 'depscore',
          arguments: { packages: [{ depname: 'foo' }] },
        },
      },
      {},
    )) as { content: Array<{ text: string; type: string }>; isError?: boolean }
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Authentication is required')
  })
})
