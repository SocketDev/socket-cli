/**
 * Unit tests for the MCP server factory.
 *
 * Tests createConfiguredServer(config) — wires the low-level SDK `Server` class
 * with two request handlers (tools/list, tools/call) and the full Socket tool
 * set. We test by invoking the registered handlers directly.
 *
 * Test Coverage:
 *
 * - Server identifies itself with the configured name + version
 * - Capabilities advertise tools{}
 * - Tools/list returns every tool with plain-JSON-Schema input schemas and a
 *   readOnlyHint annotation
 * - Tools/call dispatches to runDepscore and returns its result
 * - Tools/call rejects unknown tool names with isError + message
 * - Tools/call validates input via the TypeBox-compiled checker
 * - Tools/call uses the per-request OAuth token from extra.authInfo
 * - Tools/call falls back to config.getApiToken() when authInfo is absent
 * - Tools/call surfaces "Authentication is required." with no token
 * - A handler that throws becomes an isError result, not a protocol failure
 *
 * Related Files: - src/commands/mcp/server.mts - Implementation -
 * src/commands/mcp/depscore.mts - Tool worker, mocked here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  buildSocketToolSpecs,
  createConfiguredServer,
  toToolHandlerExtra,
} from '../../../../src/commands/mcp/server.mts'

import type * as DepscoreModule from '../../../../src/commands/mcp/depscore.mts'

const { mockRunDepscore } = vi.hoisted(() => ({
  mockRunDepscore: vi.fn(),
}))

vi.mock(
  import('../../../../src/commands/mcp/depscore.mts'),
  async importOriginal => {
    const actual = await importOriginal<typeof DepscoreModule>()
    return {
      ...actual,
      runDepscore: mockRunDepscore,
    }
  },
)

// Helper: invoke a handler from the underlying SDK Server. The SDK
// exposes `.setRequestHandler` but not a public `.handle(...)`, so we
// pull the registered handler off the internal `_requestHandlers` map.
type AnyServer = {
  _requestHandlers: Map<
    string,
    (req: unknown, extra: unknown) => Promise<unknown>
  >
}

type ToolListing = {
  tools: Array<{
    annotations?: { readOnlyHint?: boolean | undefined } | undefined
    description: string
    inputSchema: Record<string, unknown>
    name: string
    title?: string | undefined
  }>
}

type ToolCallResponse = {
  content: Array<{ text: string; type: string }>
  isError?: boolean | undefined
}

function getHandler(
  server: ReturnType<typeof createConfiguredServer>,
  schema: typeof CallToolRequestSchema | typeof ListToolsRequestSchema,
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

describe('buildSocketToolSpecs', () => {
  it('exposes the full Socket tool set by default', () => {
    expect(buildSocketToolSpecs().map(s => s.name)).toEqual([
      'depscore',
      'organizations',
      'alerts',
      'threat_feed',
      'package_files',
      'package_file_contents',
      'package_file_grep',
    ])
  })

  it('gives every tool a unique name, a title, and a description', () => {
    const specs = buildSocketToolSpecs()
    expect(new Set(specs.map(s => s.name)).size).toBe(specs.length)
    for (const spec of specs) {
      expect(spec.title.length).toBeGreaterThan(0)
      expect(spec.description.length).toBeGreaterThan(0)
    }
  })

  it('marks every tool read-only — no Socket tool mutates state', () => {
    for (const spec of buildSocketToolSpecs()) {
      expect(spec.annotations?.readOnlyHint).toBe(true)
    }
  })
})

describe('createConfiguredServer — tools/list handler', () => {
  it('lists every tool with its metadata', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, ListToolsRequestSchema)
    const result = (await handler(
      { method: 'tools/list', params: {} },
      {},
    )) as ToolListing
    expect(result.tools).toHaveLength(7)
    const depscore = result.tools.find(t => t.name === 'depscore')
    expect(depscore?.title).toBe('Dependency Score Tool')
    expect(depscore?.annotations?.readOnlyHint).toBe(true)
    expect(depscore?.description).toContain('depscore')
  })

  it('emits plain JSON Schema for every tool (no TypeBox symbols)', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, ListToolsRequestSchema)
    const result = (await handler(
      { method: 'tools/list', params: {} },
      {},
    )) as ToolListing
    for (const tool of result.tools) {
      expect(() => JSON.parse(JSON.stringify(tool.inputSchema))).not.toThrow()
      expect(tool.inputSchema['type']).toBe('object')
      const symbolKeys = Reflect.ownKeys(tool.inputSchema).filter(
        k => typeof k === 'symbol',
      )
      expect(symbolKeys).toHaveLength(0)
    }
  })

  it('advertises org_slug as required on the org-scoped tools', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, ListToolsRequestSchema)
    const result = (await handler(
      { method: 'tools/list', params: {} },
      {},
    )) as ToolListing
    for (const name of ['alerts', 'threat_feed']) {
      const tool = result.tools.find(t => t.name === name)
      expect(tool?.inputSchema['required']).toContain('org_slug')
    }
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
          arguments: { packages: [{ depname: 'lodash' }] },
          name: 'depscore',
        },
      },
      {},
    )) as ToolCallResponse
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
        params: { arguments: {}, name: 'unknown-tool' },
      },
      {},
    )) as ToolCallResponse
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
        params: { arguments: {}, name: 'depscore' },
      },
      {},
    )) as ToolCallResponse
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
        params: { arguments: { packages: 'not-an-array' }, name: 'depscore' },
      },
      {},
    )) as ToolCallResponse
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Invalid arguments for depscore')
  })

  it('validates the org-scoped tools before any network call', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: { arguments: { org_slug: 42 }, name: 'alerts' },
      },
      {},
    )) as ToolCallResponse
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Invalid arguments for alerts')
  })

  it('uses the OAuth token from extra.authInfo when present', async () => {
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    await handler(
      {
        method: 'tools/call',
        params: {
          arguments: { packages: [{ depname: 'foo' }] },
          name: 'depscore',
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
          arguments: { packages: [{ depname: 'foo' }] },
          name: 'depscore',
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
          arguments: { packages: [{ depname: 'foo' }] },
          name: 'depscore',
        },
      },
      {},
    )) as ToolCallResponse
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Authentication is required')
  })

  it('converts a thrown handler into an isError result rather than failing the session', async () => {
    mockRunDepscore.mockRejectedValueOnce(new Error('boom'))
    const server = createConfiguredServer(baseConfig)
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: {
          arguments: { packages: [{ depname: 'foo' }] },
          name: 'depscore',
        },
      },
      {},
    )) as ToolCallResponse
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('boom')
  })

  it('refuses the org-scoped tools when the configured token is a shared operator token', async () => {
    const server = createConfiguredServer({
      ...baseConfig,
      sharedApiToken: true,
    })
    const handler = getHandler(server, CallToolRequestSchema)
    const result = (await handler(
      {
        method: 'tools/call',
        params: { arguments: {}, name: 'organizations' },
      },
      {},
    )) as ToolCallResponse
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Authentication is required')
  })
})

describe('toToolHandlerExtra', () => {
  it('carries the auth token through', () => {
    expect(toToolHandlerExtra({ authInfo: { token: 'abc' } })).toEqual({
      authInfo: { token: 'abc' },
    })
  })

  it('yields an empty extra when the transport supplied no auth info', () => {
    expect(toToolHandlerExtra({})).toEqual({})
  })
})
