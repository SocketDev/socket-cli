/* max-file-lines: test — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for the MCP Streamable HTTP transport.
 *
 * Tests runHttpTransport(config) by booting a real HTTP server on an ephemeral
 * port and hitting it with @socketsecurity/lib/http-request. This exercises the
 * full request pipeline (origin/host validation, CORS, OAuth introspection,
 * well-known endpoints, body cap, stateless MCP hand-off) without poking at
 * private internals.
 *
 * Test Coverage:
 *
 * - GET /health bypasses Origin validation and returns service info
 * - Invalid Origin → 403 with JSON-RPC error envelope
 * - Allowed origins (mcp.socket.dev, mcp.socket-staging.dev, localhost variants)
 *   → request proceeds
 * - Localhost subdomain spoof rejected, Host strict-match
 * - CORS headers set on origin-bearing requests
 * - OPTIONS preflight returns 200
 * - Unknown URL path → 404
 * - Method not allowed (PATCH) on / → 405
 * - GET / without sessionId → 404
 * - DELETE / without sessionId → 404
 * - POST / without sessionId and without initialize body → 400
 * - Stateless serving: no Mcp-Session-Id is minted, a bare tools/list is served
 *   without a prior initialize, and GET / DELETE get the handler's 405
 * - OAuth disabled: requests proceed without Authorization
 * - OAuth enabled: well-known/oauth-protected-resource returned
 * - OAuth enabled: missing Authorization → 401 with WWW-Authenticate
 * - OAuth enabled: invalid token format → 401
 * - OAuth enabled: introspection inactive → 401 invalid_token
 * - OAuth enabled: missing required scope → 403 insufficient_scope
 * - OAuth enabled: expired token → 401
 * - OAuth enabled: token introspection error → 500
 * - RFC 8707: a token whose aud names another resource → 401, a token whose aud
 *   names this one → served, an absent aud → served by default and refused once
 *   require-audience is on
 *
 * The four security properties this transport must not lose get their own
 * named describes: loopback-only bind when unauthenticated, fail-closed auth,
 * Host + Origin validation, and the byte-measured request body cap.
 *
 * Related Files:
 *
 * - Src/commands/mcp/transport-http.mts - Implementation
 * - Src/commands/mcp/server.mts - Server factory (real)
 * - @modelcontextprotocol/server - createMcpHandler (real)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'

import { runHttpTransport } from '../../../../src/commands/mcp/transport-http.mts'

import type * as HttpModule from 'node:http'
import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'
import type { AddressInfo } from 'node:net'
import type * as NetModule from 'node:net'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
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

const { mockSetupSdk, mockBatchPackageFetch } = vi.hoisted(() => ({
  mockSetupSdk: vi.fn(),
  mockBatchPackageFetch: vi.fn(),
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  setupSdk: mockSetupSdk,
  getDefaultApiToken: vi.fn(() => 'test_default'),
}))

const { createdServers } = vi.hoisted(() => ({
  createdServers: [] as HttpModule.Server[],
}))

// Wrap `createServer` so every listener this file boots is reachable: a test
// can read the address the kernel actually bound (the loopback-bind property)
// and afterEach can close it. The wrapper is otherwise transparent.
vi.mock(import('node:http'), async importOriginal => {
  const actual = await importOriginal<typeof HttpModule>()
  const createServer = ((...args: Parameters<typeof actual.createServer>) => {
    const server = actual.createServer(...args)
    createdServers.push(server)
    return server
  }) as typeof actual.createServer
  return {
    ...actual,
    createServer,
    default: { ...actual.default, createServer },
  }
})

// runHttpTransport doesn't return a stop handle, so `startServer` picks the
// listener out of `createdServers` and afterEach closes it. Each test still
// takes a fresh ephemeral port so a lingering keep-alive socket from the
// previous test can never answer for the next one.
// Mirrors MAX_MCP_REQUEST_BODY_BYTES in the transport. Restated here rather
// than imported: a value used to BUILD an expectation must not come from the
// module under test, or the assertion moves with the bug.
const BODY_CAP_BYTES = 4 * 1024 * 1024

let nextPort = 23_900

function freshPort(): number {
  return nextPort++
}

let nextIssuerPort = 23_800

function freshIssuerPort(): number {
  return nextIssuerPort++
}

// Stand up a tiny in-memory OAuth issuer on a per-test ephemeral port so each
// scenario gets a fresh server (port collisions across tests caused
// ECONNRESET when we shared one).
async function mockIssuerServer(opts: {
  introspectionResponse:
    | Record<string, unknown>
    | (() => Record<string, unknown>)
  introspectionStatus?: number | undefined
}): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = require('node:http') as typeof HttpModule
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

function initializeBody(clientName = 'test', clientVersion = '0.0.1'): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    },
  })
}

/**
 * Speak raw HTTP so a test can control headers `httpRequest` would normalize
 * (a `//` path, a bare `Host`, an absent `Accept`). Reads until the server
 * stops sending or `idleMs` passes with no data — the SDK's 2025-era stateless
 * fallback answers over SSE and leaves the connection keep-alive, so waiting
 * for socket end would stall on the keep-alive timeout.
 */
function rawRequest(
  port: number,
  message: string,
  idleMs = 300,
): Promise<string> {
  const net = require('node:net') as typeof NetModule
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let idle: NodeJS.Timeout | undefined
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(message)
    })
    const finish = () => {
      clearTimeout(idle)
      socket.destroy()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    socket.on('data', c => {
      chunks.push(c)
      clearTimeout(idle)
      idle = setTimeout(finish, idleMs)
    })
    socket.on('end', finish)
    socket.on('error', reject)
  })
}

const baseConfig = {
  getApiToken: () => 'test_local',
  serverName: 'socket',
  version: '0.0.1',
}

async function startServer(
  overrides: Partial<{
    oauthAllowLocalIssuer: boolean
    oauthClientId: string
    oauthClientSecret: string
    oauthIssuer: string
    oauthRequireAudience: boolean
    oauthRequiredScopes: readonly string[]
    port: number
    trustProxy: boolean
  }> = {},
) {
  const port = overrides.port ?? freshPort()
  const config = {
    ...baseConfig,
    // Every OAuth scenario here stands up its issuer on loopback, which the
    // SSRF guard refuses unless a caller opts in. Default the opt-in on so the
    // helper mirrors a local dev stack; the guard's closed default gets its own
    // test below.
    oauthAllowLocalIssuer: overrides.oauthAllowLocalIssuer ?? true,
    oauthClientId: overrides.oauthClientId ?? '',
    oauthClientSecret: overrides.oauthClientSecret ?? '',
    oauthIssuer: overrides.oauthIssuer ?? '',
    oauthRequireAudience: overrides.oauthRequireAudience ?? false,
    oauthRequiredScopes:
      overrides.oauthRequiredScopes ?? (['packages:list'] as const),
    port,
    trustProxy: overrides.trustProxy ?? false,
  }
  const createdBefore = createdServers.length
  await runHttpTransport(config)
  return { port, server: createdServers[createdBefore]! }
}

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

afterEach(async () => {
  // Close every listener this test booted. Keep-alive sockets outlive the
  // response on the SSE path, so drop them explicitly or close() never
  // completes.
  await Promise.allSettled(
    createdServers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  // Drain any pending logger calls.
  vi.clearAllMocks()
})

describe('runHttpTransport — request URL parsing', () => {
  it('returns 400 + JSON-RPC error for an unparseable request URL', async () => {
    const { port } = await startServer()
    // `//` parses to throw on `new URL('//', 'http://localhost:N')`.
    // httpRequest can't send `//` directly, it normalizes, so use raw
    // TCP to bypass the client-side normalization.
    const body = await rawRequest(
      port,
      `GET // HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
    )
    expect(body).toContain('400')
    expect(body).toContain('Bad Request: Invalid URL')
  })
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

describe('runHttpTransport — Host and Origin validation (DNS rebinding)', () => {
  it('rejects an unknown origin with 403 + JSON-RPC error', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: { origin: 'https://attacker.example' },
      method: 'POST',
      body: '{}',
    })
    expect(res.status).toBe(403)
    const body = JSON.parse(res.text())
    expect(body.error.code).toBe(-32_000)
    expect(body.error.message).toContain('Forbidden: Invalid origin')
  })

  it('accepts a localhost origin', async () => {
    const { port } = await startServer()
    // Serving is stateless, so this reaches the MCP handler and comes back
    // with the tool list rather than a session error.
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        origin: `http://localhost:${port}`,
      },
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(200)
    expect(res.text()).toContain('depscore')
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
    expect(res.status).toBe(200)
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
    expect(res.status).toBe(200)
  })

  it('accepts bare localhost (no port) in Host header', async () => {
    const { port } = await startServer()
    // Raw TCP so we can set Host without auto-appending the port.
    // /health bypasses Origin validation but the test confirms the
    // bare-localhost host parsing branch in the HTTP server.
    const response = await rawRequest(
      port,
      `GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
    )
    expect(response).toContain('200')
  })

  it('accepts bare 127.0.0.1 in Host header', async () => {
    const { port } = await startServer()
    // Host is bare 127.0.0.1, no port, no Origin → falls through to
    // arm3 of the host check, which accepts.
    const response = await rawRequest(
      port,
      `POST / HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Content-Length: 2\r\n` +
        `Connection: close\r\n\r\n{}`,
    )
    expect(response).not.toContain('403')
  })

  it('accepts mcp.socket.dev as a Host (not just Origin)', async () => {
    const { port } = await startServer()
    const response = await rawRequest(
      port,
      `POST / HTTP/1.1\r\n` +
        `Host: mcp.socket.dev\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Content-Length: 2\r\n` +
        `Connection: close\r\n\r\n{}`,
    )
    expect(response).not.toContain('403')
  })

  it('accepts a non-allowlisted Origin once Host matches the hosted deployment', async () => {
    // Claude Desktop's custom connector (and other native MCP clients) send
    // an Origin header their HTTP stack sets automatically; Bearer-token
    // auth, not Origin, is what actually gates the hosted deployment. This
    // is the regression case for that report.
    const { port } = await startServer()
    const response = await rawRequest(
      port,
      `POST / HTTP/1.1\r\n` +
        `Host: mcp.socket.dev\r\n` +
        `Origin: https://claude.ai\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Content-Length: 2\r\n` +
        `Connection: close\r\n\r\n{}`,
    )
    expect(response).not.toContain('403')
  })

  it('rejects a request with no Origin and a non-allowlist Host (logs "missing")', async () => {
    const { port } = await startServer()
    // Send via raw TCP with a Host that's none of the allowed values
    // and no Origin header.
    const response = await rawRequest(
      port,
      `POST / HTTP/1.1\r\n` +
        `Host: evil.example.com\r\n` +
        `Content-Length: 2\r\n` +
        `Connection: close\r\n\r\n{}`,
    )
    expect(response).toContain('403')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rejected request from invalid origin: missing'),
    )
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

  it('rejects a foreign Host on the OAuth metadata path too', async () => {
    const { port } = await startServer()
    const response = await rawRequest(
      port,
      `GET /.well-known/oauth-protected-resource HTTP/1.1\r\n` +
        `Host: attacker.example\r\n` +
        `Connection: close\r\n\r\n`,
    )
    expect(response).toContain('403')
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

describe('runHttpTransport — loopback-only bind when unauthenticated', () => {
  it('binds 127.0.0.1 when no OAuth introspector is configured', async () => {
    const { server } = await startServer()
    // Without per-client authentication the server must not be reachable
    // from the network: the Host-header check is spoofable by a non-browser
    // client and is not an auth boundary.
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('(bound to 127.0.0.1)'),
    )
  })

  it('binds every interface once OAuth authenticates each request', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: { active: true, scope: 'packages:list' },
    })
    try {
      const { server } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      const { address } = server.address() as AddressInfo
      expect(['::', '0.0.0.0']).toContain(address)
    } finally {
      await issuer.close()
    }
  })
})

describe('runHttpTransport — trust-proxy', () => {
  it('honors X-Forwarded-Proto/Host when trustProxy=true', async () => {
    const { port } = await startServer({ trustProxy: true })
    // The forwarded headers are read by getRequestBaseUrl, which feeds the
    // advertised OAuth metadata URL. Verify the request goes through when
    // X-Forwarded-Proto says https and Host is localhost.
    const res = await httpRequest(`http://127.0.0.1:${port}/health`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': `localhost:${port}`,
        host: `localhost:${port}`,
      },
    })
    expect(res.status).toBe(200)
  })
})

describe('runHttpTransport — Accept header patching', () => {
  it('patches Accept when missing application/json + text/event-stream (POST init)', async () => {
    const { port } = await startServer()
    // Send POST with only `application/json` in Accept; the SDK would
    // 406 without the patch.
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      body: initializeBody(),
    })
    expect(res.status).toBe(200)
    expect(res.text()).toContain('protocolVersion')
  })

  it('patches Accept when header is missing entirely', async () => {
    const { port } = await startServer()
    // Use raw TCP so httpRequest doesn't auto-add Accept.
    const body = initializeBody()
    const response = await rawRequest(
      port,
      `POST / HTTP/1.1\r\n` +
        `Host: localhost:${port}\r\n` +
        `Content-Type: application/json\r\n` +
        `Origin: http://localhost:${port}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n\r\n${body}`,
    )
    expect(response).toContain('200')
    expect(response).toContain('protocolVersion')
  })
})

describe('runHttpTransport — request body size cap', () => {
  it('answers 413 for a multibyte body over the byte cap but under the char cap', async () => {
    // The cap is 4 MiB. 1.1M copies of a two-character multibyte pair is well
    // over 4 MiB on the wire but under 4M JS characters, so a string-length
    // check would let it through. The cap must be measured in bytes.
    const { port } = await startServer()
    const oversized = `{"pad":"${'éé'.repeat(1_100_000)}"}`
    expect(oversized.length).toBeLessThan(BODY_CAP_BYTES)
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(BODY_CAP_BYTES)
    // Reading a status here at all is the drain assertion: the refusal is
    // written while the client is still uploading, and destroying the socket
    // at that point resets its pending writes, so the client would see a
    // connection error instead of the 413.
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      body: oversized,
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        origin: `http://localhost:${port}`,
      },
      method: 'POST',
    })
    expect(res.status).toBe(413)
    expect(JSON.parse(res.text()).error).toContain('exceeds')
  })

  it('never hands an over-cap body to the MCP handler', async () => {
    const { port } = await startServer()
    // A well-formed initialize, padded past the cap. It must be refused
    // before the handler ever parses it, so the connect log never fires.
    const pad = 'x'.repeat(BODY_CAP_BYTES + 1024)
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'padded', version: '0.0.1' },
          pad,
        },
      }),
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        origin: `http://localhost:${port}`,
      },
      method: 'POST',
    })
    expect(res.status).toBe(413)
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Client connected: padded'),
    )
  })

  it('accepts a body just under the cap', async () => {
    const { port } = await startServer()
    const pad = 'x'.repeat(BODY_CAP_BYTES - 1024)
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { pad },
      }),
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        origin: `http://localhost:${port}`,
      },
      method: 'POST',
    })
    expect(res.status).toBe(200)
  })
})

describe('runHttpTransport — stateless serving', () => {
  it('mints no Mcp-Session-Id on initialize', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      body: initializeBody('test-client'),
    })
    expect(res.status).toBe(200)
    expect(res.headers['mcp-session-id']).toBeUndefined()
  })

  it('serves a tools/list with no prior initialize and no session header', async () => {
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
    expect(res.status).toBe(200)
    expect(res.text()).toContain('package_file_grep')
  })

  it('ignores a stale Mcp-Session-Id rather than rejecting the request', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
        'mcp-session-id': 'stale-session-that-doesnt-exist',
      },
      method: 'POST',
      body: initializeBody(),
    })
    expect(res.status).toBe(200)
    expect(res.headers['mcp-session-id']).toBeUndefined()
  })

  it('answers GET / with 405 — there is no standalone session stream', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
      },
      method: 'GET',
    })
    expect(res.status).toBe(405)
  })

  it('answers DELETE / with 405 — there is no session to tear down', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
      },
      method: 'DELETE',
    })
    expect(res.status).toBe(405)
  })
})

describe('runHttpTransport — POST body parsing errors', () => {
  it('returns 500 on malformed JSON body', async () => {
    const { port } = await startServer()
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      body: '{not valid json',
    })
    expect(res.status).toBe(500)
    const body = JSON.parse(res.text())
    expect(body.error.code).toBe(-32_603)
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

  it('logs "unknown" client name/version when clientInfo fields are empty', async () => {
    const { port } = await startServer()
    await httpRequest(`http://127.0.0.1:${port}/`, {
      headers: {
        accept: 'application/json, text/event-stream',
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      // Empty strings → both `?.name || 'unknown'` and `?.version ||
      // 'unknown'` short-circuit to the right-hand fallback.
      body: initializeBody('', ''),
    })
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Client connected: unknown vunknown'),
    )
  })

  it('logs the host when origin is absent on initialize', async () => {
    const { port } = await startServer()
    // Use raw TCP to omit Origin entirely.
    const body = initializeBody('noorigin', '1.0.0')
    await rawRequest(
      port,
      `POST / HTTP/1.1\r\n` +
        `Host: localhost:${port}\r\n` +
        `Content-Type: application/json\r\n` +
        `Accept: application/json, text/event-stream\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n\r\n${body}`,
    )
    // Origin is empty → logs use the Host instead.
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(`from localhost:${port}`),
    )
  })
})

describe('runHttpTransport — OAuth startup failure', () => {
  it('throws when the OAuth issuer is unreachable on startup', async () => {
    // Point the issuer at a port that's not listening — loadMetadata
    // fails and runHttpTransport rethrows after logging.
    const port = freshPort()
    await expect(
      startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: 'http://127.0.0.1:1', // port 1 is reserved/closed
        port,
      }),
    ).rejects.toThrow()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialize OAuth metadata:'),
    )
  })

  it('refuses a loopback OAuth issuer when the local opt-in is off', async () => {
    const port = freshPort()
    await expect(
      startServer({
        oauthAllowLocalIssuer: false,
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: 'http://127.0.0.1:9',
        port,
      }),
    ).rejects.toThrow(/private\/loopback host/)
  })

  it('refuses a link-local OAuth issuer even when the local opt-in is on', async () => {
    const port = freshPort()
    await expect(
      startServer({
        oauthAllowLocalIssuer: true,
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        // The cloud instance-metadata address — the canonical SSRF target.
        oauthIssuer: 'http://169.254.169.254',
        port,
      }),
    ).rejects.toThrow(/private\/loopback host/)
  })

  it('refuses a non-http(s) OAuth issuer scheme', async () => {
    const port = freshPort()
    await expect(
      startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: 'file:///etc/passwd',
        port,
      }),
    ).rejects.toThrow(/must use http\(s\)/)
  })
})

describe('runHttpTransport — OAuth disabled', () => {
  it('serves /.well-known/oauth-protected-resource as 404 when OAuth is off', async () => {
    const { port } = await startServer()
    const res = await httpRequest(
      `http://127.0.0.1:${port}/.well-known/oauth-protected-resource`,
      {
        headers: { origin: `http://localhost:${port}` },
      },
    )
    // OAuth not enabled → falls through to the unknown-path 404.
    expect(res.status).toBe(404)
  })
})

describe('runHttpTransport — auth is enforced on every request, fail-closed', () => {
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

  it('refuses an unauthenticated tools/list instead of falling through to the operator token', async () => {
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
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      })
      expect(res.status).toBe(401)
      // The MCP handler must never have run: no tool metadata leaks.
      expect(res.text()).not.toContain('depscore')
    } finally {
      await issuer.close()
    }
  })

  it('refuses an unauthenticated GET', async () => {
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
        },
        method: 'GET',
      })
      expect(res.status).toBe(401)
    } finally {
      await issuer.close()
    }
  })

  it('refuses an unauthenticated DELETE', async () => {
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
        },
        method: 'DELETE',
      })
      expect(res.status).toBe(401)
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
})

describe('runHttpTransport — OAuth enabled', () => {
  it('proceeds through the request pipeline on a valid OAuth token', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        client_id: 'user-app',
        scope: 'packages:list',
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
          authorization: 'Bearer the-good-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: initializeBody('oauth-client'),
      })
      // Auth succeeds → request reaches the initialize handler.
      expect(res.status).toBe(200)
      expect(res.text()).toContain('protocolVersion')
    } finally {
      await issuer.close()
    }
  })

  it("hands the caller's own bearer to the tool layer, not the operator token", async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        client_id: 'user-app',
        scope: 'packages:list',
      },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
      })
      await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer caller-own-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'depscore',
            arguments: { packages: [{ depname: 'lodash' }] },
          },
        }),
      })
      // The bearer rides req.auth → ctx.http.authInfo → toToolHandlerExtra.
      expect(mockSetupSdk).toHaveBeenCalledWith(
        expect.objectContaining({ apiToken: 'caller-own-token' }),
      )
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
      expect(body.bearer_methods_supported).toEqual(['header'])
      // The advertised identifier is exactly what the audience check compares
      // against, so a client that requests a token for this value gets one this
      // server accepts.
      expect(body.resource).toBe(`http://127.0.0.1:${port}/`)
    } finally {
      await issuer.close()
    }
  })
})

describe('runHttpTransport — RFC 8707 audience binding', () => {
  it('refuses a token whose aud names another resource server', async () => {
    // Confused deputy: the same authorization server introspects the token as
    // active, but it was minted for a resource on another port — a different
    // resource identifier, and so a different resource server.
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        aud: 'http://127.0.0.1:9/',
        client_id: 'user-app',
        scope: 'packages:list',
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
          authorization: 'Bearer token-for-another-resource',
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
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toContain('invalid_token')
      // The MCP handler must never have run: no tool metadata leaks.
      expect(res.text()).not.toContain('depscore')
    } finally {
      await issuer.close()
    }
  })

  it('accepts a token whose aud names this resource server', async () => {
    const port = freshPort()
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        aud: `http://127.0.0.1:${port}/`,
        client_id: 'user-app',
        scope: 'packages:list',
      },
    })
    try {
      await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
        port,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer token-for-this-resource',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: initializeBody('audience-bound-client'),
      })
      expect(res.status).toBe(200)
      expect(res.text()).toContain('protocolVersion')
    } finally {
      await issuer.close()
    }
  })

  it('accepts a token carrying no aud claim by default', async () => {
    // Socket's introspection endpoint does not emit `aud` yet, so absence must
    // stay accepted or every current deployment breaks.
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        client_id: 'user-app',
        scope: 'packages:list',
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
          authorization: 'Bearer audience-less-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: initializeBody('audience-less-client'),
      })
      expect(res.status).toBe(200)
    } finally {
      await issuer.close()
    }
  })

  it('refuses a token carrying no aud claim once require-audience is on', async () => {
    const issuer = await mockIssuerServer({
      introspectionResponse: {
        active: true,
        client_id: 'user-app',
        scope: 'packages:list',
      },
    })
    try {
      const { port } = await startServer({
        oauthClientId: 'cid',
        oauthClientSecret: 'csec',
        oauthIssuer: issuer.url,
        oauthRequireAudience: true,
      })
      const res = await httpRequest(`http://127.0.0.1:${port}/`, {
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer audience-less-token',
          origin: `http://localhost:${port}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        body: initializeBody('audience-less-client'),
      })
      expect(res.status).toBe(401)
      expect(res.headers['www-authenticate']).toContain('invalid_token')
    } finally {
      await issuer.close()
    }
  })
})
