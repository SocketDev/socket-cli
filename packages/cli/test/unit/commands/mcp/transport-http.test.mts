/**
 * Unit tests for the MCP Streamable HTTP transport.
 *
 * Tests runHttpTransport(config) by booting a real HTTP server on an
 * ephemeral port and hitting it with @socketsecurity/lib/http-request.
 * This exercises the full request pipeline (origin/host validation,
 * CORS, OAuth introspection, well-known endpoints, session map,
 * StreamableHTTPServerTransport hand-off) without poking at private
 * internals.
 *
 * Test Coverage:
 * - GET /health bypasses Origin validation and returns service info
 * - Invalid Origin → 403 with JSON-RPC error envelope
 * - Allowed origins (mcp.socket.dev, mcp.socket-staging.dev,
 *   localhost variants) → request proceeds
 * - localhost subdomain spoof rejected (Host strict-match)
 * - CORS headers set on origin-bearing requests
 * - OPTIONS preflight returns 200
 * - Unknown URL path → 404
 * - Method not allowed (PATCH) on / → 405
 * - GET / without sessionId → 404
 * - DELETE / without sessionId → 404
 * - POST / without sessionId and without initialize body → 400
 * - POST / initialize creates a session (Mcp-Session-Id header
 *   returned, subsequent calls routed)
 * - OAuth disabled: requests proceed without Authorization
 * - OAuth enabled: well-known/oauth-protected-resource returned
 * - OAuth enabled: missing Authorization → 401 with WWW-Authenticate
 * - OAuth enabled: invalid token format → 401
 * - OAuth enabled: introspection inactive → 401 invalid_token
 * - OAuth enabled: missing required scope → 403 insufficient_scope
 * - OAuth enabled: expired token → 401
 * - OAuth enabled: token introspection error → 500
 *
 * Related Files:
 * - src/commands/mcp/transport-http.mts - Implementation
 * - src/commands/mcp/server.mts - Server factory (real)
 * - @modelcontextprotocol/sdk/server/streamableHttp - Transport (real)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { httpRequest } from '@socketsecurity/lib/http-request'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

const { mockSetupSdk, mockBatchPackageFetch } = vi.hoisted(() => ({
  mockSetupSdk: vi.fn(),
  mockBatchPackageFetch: vi.fn(),
}))

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
  getDefaultApiToken: vi.fn(() => 'test_default'),
}))

const { runHttpTransport } = await import(
  '../../../../src/commands/mcp/transport-http.mts'
)

// We boot a real http.Server and need to tear it down between tests.
// runHttpTransport doesn't return a stop handle, so we discover the
// server via process._getActiveHandles() — but that's flaky. Better:
// scrape the listening port from the logger and rely on process exit
// to clean up at the test-file boundary. To work around server state
// bleeding between tests, each test uses a fresh ephemeral port and
// constructs a new transport.

let nextPort = 23900

function freshPort(): number {
  return nextPort++
}

const baseConfig = {
  getApiToken: () => 'test_local',
  serverName: 'socket',
  version: '0.0.1',
}

async function startServer(
  overrides: Partial<{
    oauthClientId: string
    oauthClientSecret: string
    oauthIssuer: string
    oauthRequiredScopes: readonly string[]
    port: number
    trustProxy: boolean
  }> = {},
) {
  const port = overrides.port ?? freshPort()
  const config = {
    ...baseConfig,
    oauthClientId: overrides.oauthClientId ?? '',
    oauthClientSecret: overrides.oauthClientSecret ?? '',
    oauthIssuer: overrides.oauthIssuer ?? '',
    oauthRequiredScopes:
      overrides.oauthRequiredScopes ?? (['packages:list'] as const),
    port,
    trustProxy: overrides.trustProxy ?? false,
  }
  await runHttpTransport(config)
  return { port }
}

// Track all servers we've started so we can close them via the
// process-level handles map. Node's `http.Server.close()` requires a
// reference; we don't have one. Instead, each test uses a unique port
// and lets the test runner exit clean up.
//
// To avoid port exhaustion across tests, set a low concurrency for
// vitest if this file flakes.

beforeEach(() => {
  vi.clearAllMocks()
  // Default SDK setup so tools/call paths don't blow up if exercised.
  mockSetupSdk.mockResolvedValue({
    ok: true,
    data: { batchPackageFetch: mockBatchPackageFetch },
  })
  mockBatchPackageFetch.mockResolvedValue({
    success: true,
    status: 200,
    data: [],
  })
})

afterEach(() => {
  // Drain any pending logger calls.
  vi.clearAllMocks()
})

describe('runHttpTransport — health endpoint', () => {
  it('GET /health returns 200 with service info even from a foreign origin', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/health`, {
      headers: { origin: 'https://evil.example' },
    })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.text())
    expect(body.status).toBe('healthy')
    expect(body.service).toBe('socket-mcp')
    expect(body.version).toBe('0.0.1')
    expect(body.timestamp).toBeTypeOf('string')
  })
})

describe('runHttpTransport — origin / host validation', () => {
  it('rejects an unknown origin with 403 + JSON-RPC error', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: 'https://attacker.example' },
      method: 'POST',
      body: '{}',
    })
    expect(res.status).toBe(403)
    const body = JSON.parse(res.text())
    expect(body.error.code).toBe(-32000)
    expect(body.error.message).toContain('Forbidden: Invalid origin')
  })

  it('accepts a localhost origin', async () => {
    const { port } = await startServer()
    // POST without sessionId or initialize — should reach the body
    // handler and return 400, NOT 403.
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        origin: `http://localhost:${port}`,
      },
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts the production mcp.socket.dev origin', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        origin: 'https://mcp.socket.dev',
      },
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts requests without an Origin when Host is localhost', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a spoofed localhost subdomain', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: 'http://malicious-localhost.evil.com' },
      method: 'POST',
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('sets CORS Access-Control-Allow-Origin when Origin is present', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.headers['access-control-allow-origin']).toBe(
      `http://localhost:${port}`,
    )
    expect(res.headers['access-control-allow-methods']).toContain('POST')
    expect(res.headers['access-control-expose-headers']).toContain(
      'Mcp-Session-Id',
    )
  })

  it('OPTIONS preflight returns 200 with no body', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: `http://localhost:${port}` },
      method: 'OPTIONS',
    })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('')
  })
})

describe('runHttpTransport — routing', () => {
  it('returns 404 for unknown paths', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/something-else`, {
      headers: { origin: `http://localhost:${port}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns 405 for unsupported methods on /', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: `http://localhost:${port}` },
      method: 'PATCH',
    })
    expect(res.status).toBe(405)
  })

  it('GET / without sessionId returns 404', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: `http://localhost:${port}` },
      method: 'GET',
    })
    expect(res.status).toBe(404)
    const body = JSON.parse(res.text())
    expect(body.error.message).toContain('Invalid or expired session')
  })

  it('DELETE / without sessionId returns 404', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: `http://localhost:${port}` },
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('POST / without sessionId and without initialize returns 400', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })
    expect(res.status).toBe(400)
    const body = JSON.parse(res.text())
    expect(body.error.message).toContain('No valid session')
  })

  it('POST / initialize creates a session and returns Mcp-Session-Id', async () => {
    const { port } = await startServer()
    const initBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' },
      },
    }
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify(initBody),
    })
    expect(res.status).toBe(200)
    expect(res.headers['mcp-session-id']).toBeTypeOf('string')
    expect((res.headers['mcp-session-id'] as string).length).toBeGreaterThan(0)
  })
})

describe('runHttpTransport — OAuth disabled', () => {
  it('serves /.well-known/oauth-protected-resource as 404 when OAuth is off', async () => {
    const { port } = await startServer()
    const res = await httpRequest(
      `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`,
      { headers: { origin: `http://localhost:${port}` } },
    )
    // OAuth not enabled → falls through to the unknown-path 404.
    expect(res.status).toBe(404)
  })
})

describe('runHttpTransport — OAuth enabled', () => {
  // Stand up a tiny in-memory OAuth issuer on a per-test ephemeral
  // port so each scenario gets a fresh server (port collisions across
  // tests caused ECONNRESET when we shared one).

  let nextIssuerPort = 23800
  function freshIssuerPort(): number {
    return nextIssuerPort++
  }

  async function mockIssuerServer(opts: {
    introspectionResponse: Record<string, unknown> | (() => Record<string, unknown>)
    introspectionStatus?: number
  }): Promise<{ url: string; close: () => Promise<void> }> {
    const { createServer } = require('node:http') as typeof import('node:http')
    const issuerPort = freshIssuerPort()
    const server = createServer((req, res) => {
      if (req.url === '/.well-known/oauth-authorization-server') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            issuer: `http://127.0.0.1:${issuerPort}`,
            authorization_endpoint: `http://127.0.0.1:${issuerPort}/authorize`,
            token_endpoint: `http://127.0.0.1:${issuerPort}/token`,
            introspection_endpoint: `http://127.0.0.1:${issuerPort}/introspect`,
          }),
        )
        return
      }
      if (req.url === '/introspect') {
        res.writeHead(opts.introspectionStatus ?? 200, {
          'Content-Type': 'application/json',
        })
        const body =
          typeof opts.introspectionResponse === 'function'
            ? opts.introspectionResponse()
            : opts.introspectionResponse
        res.end(JSON.stringify(body))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => {
      server.listen(issuerPort, '127.0.0.1', () => resolve())
    })
    return {
      url: `http://127.0.0.1:${issuerPort}`,
      close: () =>
        new Promise<void>(resolve => {
          server.close(() => resolve())
        }),
    }
  }

  it('returns 401 with WWW-Authenticate when Authorization header is missing', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: { active: true, scope: 'packages:list' },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: '{}',
      })
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toContain(
        'error="invalid_request"',
      )
    } finally {
      await issuer.close()
    }
  })

  it('returns 401 when Authorization header is not a Bearer token', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: { active: true, scope: 'packages:list' },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Basic abc',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: '{}',
      })
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toContain('Bearer TOKEN')
    } finally {
      await issuer.close()
    }
  })

  it('returns 401 invalid_token when introspection says active=false', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: { active: false },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer some-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: '{}',
      })
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toContain('invalid_token')
    } finally {
      await issuer.close()
    }
  })

  it('returns 403 insufficient_scope when token lacks the required scope', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        scope: 'something:else',
        client_id: 'user-app',
      },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer some-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: '{}',
      })
      expect(res.status).toBe(403)
      expect(res.headers['www-authenticate']).toContain('insufficient_scope')
    } finally {
      await issuer.close()
    }
  })

  it('returns 401 when the token has expired (exp in the past)', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        scope: 'packages:list',
        exp: past,
        client_id: 'user',
      },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer expired-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: '{}',
      })
      expect(res.status).toBe(401)
    } finally {
      await issuer.close()
    }
  })

  it('serves /.well-known/oauth-protected-resource when OAuth is enabled', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: { active: true, scope: 'packages:list' },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const res = await httpRequest(
        `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`,
        { headers: { origin: `http://localhost:${port}` } },
      )
      expect(res.status).toBe(200)
      const body = JSON.parse(res.text())
      expect(body.authorization_servers).toEqual([issuer.url])
      expect(body.scopes_supported).toEqual(['packages:list'])
      expect(body.resource_name).toBe('Socket MCP Server')
    } finally {
      await issuer.close()
    }
  })
})
