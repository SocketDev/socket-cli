/**
 * Unit tests for the MCP server factory.
 *
 * Tests createConfiguredServer(config) — wires the low-level SDK `Server` class
 * with two request handlers ('tools/list', 'tools/call') and the full Socket
 * tool set. The server is driven through a real `Client` over a linked
 * in-memory transport pair, so every assertion goes through the same protocol
 * machinery a shipping client uses.
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
 * - Tools/call uses the per-request OAuth token from ctx.http.authInfo
 * - Tools/call falls back to config.getApiToken() when authInfo is absent
 * - Tools/call surfaces "Authentication is required." with no token
 * - A handler that throws becomes an isError result, not a protocol failure
 *
 * Related Files: - src/commands/mcp/server.mts - Implementation -
 * src/commands/mcp/depscore.mts - Tool worker, mocked here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

import {
  buildSocketToolSpecs,
  createConfiguredServer,
  toToolHandlerExtra,
} from '../../../../src/commands/mcp/server.mts'

import type { CallToolResult } from '@modelcontextprotocol/client'
import type { ServerConfig } from '../../../../src/commands/mcp/server.mts'
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

const baseConfig: ServerConfig = {
  getApiToken: () => 'test_default_token',
  serverName: 'socket',
  version: '9.9.9',
}

// Teardown for whichever client/server pair the current test connected.
let closeConnection: (() => Promise<void>) | undefined

/**
 * Connect a real `Client` to a freshly configured server over a linked
 * in-memory transport pair. `InMemoryTransport` hands each message over by
 * reference, so a `tools/list` result carrying the symbol-keyed metadata
 * TypeBox attaches to a schema object fails the client's result validation —
 * which is exactly the guard we want on `schemaToJsonSchema`.
 */
async function connectClient(
  config: ServerConfig = baseConfig,
): Promise<Client> {
  const server = createConfiguredServer(config)
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' }, {})
  await client.connect(clientTransport)
  closeConnection = async () => {
    await client.close()
    await server.close()
  }
  return client
}

// The text of a tool result's first content block. `content` is a union of
// block kinds, so narrow on `type` rather than casting.
function firstText(result: CallToolResult): string {
  const [block] = result.content
  return block?.type === 'text' ? block.text : ''
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRunDepscore.mockResolvedValue({
    content: [{ text: 'ok', type: 'text' as const }],
  })
})

afterEach(async () => {
  await closeConnection?.()
  closeConnection = undefined
})

describe('createConfiguredServer — construction', () => {
  it('creates a Server with the configured name and version', async () => {
    const client = await connectClient()
    expect(client.getServerVersion()).toEqual(
      expect.objectContaining({ name: 'socket', version: '9.9.9' }),
    )
  })

  it('declares the tools capability', async () => {
    const client = await connectClient()
    expect(client.getServerCapabilities()?.tools).toBeDefined()
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

describe('createConfiguredServer — tools/list', () => {
  it('lists every tool with its metadata', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(7)
    const depscore = tools.find(t => t.name === 'depscore')
    expect(depscore?.title).toBe('Dependency Score Tool')
    expect(depscore?.annotations?.readOnlyHint).toBe(true)
    expect(depscore?.description).toContain('depscore')
  })

  it('emits plain JSON Schema for every tool (no TypeBox symbols)', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(
        Reflect.ownKeys(tool.inputSchema).filter(k => typeof k === 'symbol'),
      ).toHaveLength(0)
    }
  })

  it('advertises org_slug as required on the org-scoped tools', async () => {
    const client = await connectClient()
    const { tools } = await client.listTools()
    for (const name of ['alerts', 'threat_feed']) {
      const tool = tools.find(t => t.name === name)
      expect(tool?.inputSchema.required).toContain('org_slug')
    }
  })
})

describe('createConfiguredServer — tools/call', () => {
  it('dispatches to runDepscore for the depscore tool', async () => {
    const client = await connectClient()
    const result = await client.callTool({
      arguments: { packages: [{ depname: 'lodash' }] },
      name: 'depscore',
    })
    expect(mockRunDepscore).toHaveBeenCalledTimes(1)
    // The schema stamps defaults for ecosystem and version, so the resolved
    // request carries them even when the caller omitted both.
    expect(mockRunDepscore.mock.calls[0]![0]).toEqual({
      packages: [{ depname: 'lodash', ecosystem: 'npm', version: 'unknown' }],
    })
    expect(firstText(result)).toBe('ok')
    expect(result.isError).toBeUndefined()
  })

  it('returns isError when called with an unknown tool name', async () => {
    const client = await connectClient()
    const result = await client.callTool({
      arguments: {},
      name: 'unknown-tool',
    })
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Unknown tool: unknown-tool')
  })

  it('returns isError + validation message when arguments are missing the packages field', async () => {
    const client = await connectClient()
    const result = await client.callTool({ arguments: {}, name: 'depscore' })
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Invalid arguments for depscore')
  })

  it('returns isError when packages is the wrong shape (string instead of array)', async () => {
    const client = await connectClient()
    const result = await client.callTool({
      arguments: { packages: 'not-an-array' },
      name: 'depscore',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Invalid arguments for depscore')
  })

  it('validates the org-scoped tools before any network call', async () => {
    const client = await connectClient()
    const result = await client.callTool({
      arguments: { org_slug: 42 },
      name: 'alerts',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Invalid arguments for alerts')
  })

  it('falls back to config.getApiToken() when no per-request auth is present', async () => {
    const client = await connectClient()
    await client.callTool({
      arguments: { packages: [{ depname: 'foo' }] },
      name: 'depscore',
    })
    expect(mockRunDepscore).toHaveBeenCalledWith(
      expect.objectContaining({ packages: expect.any(Array) }),
      { apiToken: 'test_default_token' },
    )
  })

  it('surfaces the auth-required message when no token is available from either source', async () => {
    const client = await connectClient({
      ...baseConfig,
      getApiToken: () => undefined,
    })
    const result = await client.callTool({
      arguments: { packages: [{ depname: 'foo' }] },
      name: 'depscore',
    })
    expect(mockRunDepscore).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Authentication is required')
  })

  it('converts a thrown handler into an isError result rather than failing the session', async () => {
    mockRunDepscore.mockRejectedValueOnce(new Error('boom'))
    const client = await connectClient()
    const result = await client.callTool({
      arguments: { packages: [{ depname: 'foo' }] },
      name: 'depscore',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('boom')
  })

  it('refuses the org-scoped tools when the configured token is a shared operator token', async () => {
    const client = await connectClient({ ...baseConfig, sharedApiToken: true })
    const result = await client.callTool({
      arguments: {},
      name: 'organizations',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Authentication is required')
  })
})

describe('toToolHandlerExtra', () => {
  it('carries the per-request auth token through from ctx.http.authInfo', () => {
    expect(
      toToolHandlerExtra({
        http: { authInfo: { clientId: 'cid', scopes: [], token: 'abc' } },
      }),
    ).toEqual({ authInfo: { token: 'abc' } })
  })

  it('yields an empty extra when the transport supplied no HTTP context (stdio)', () => {
    expect(toToolHandlerExtra({})).toEqual({})
  })

  it('yields an empty extra when the HTTP context carries no auth info', () => {
    expect(toToolHandlerExtra({ http: {} })).toEqual({})
  })
})
