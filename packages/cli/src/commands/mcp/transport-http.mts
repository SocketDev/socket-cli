import { createServer } from 'node:http'

import { toNodeHandler } from '@modelcontextprotocol/node'
import {
  createMcpHandler,
  isInitializeRequest,
} from '@modelcontextprotocol/server'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { OAuthIntrospector } from './oauth-introspector.mts'
import { createConfiguredServer } from './server.mts'
import {
  buildProtectedResourceMetadata,
  getRequestBaseUrl,
  getRequestHeaderValue,
  handleRequestSafely,
  isLocalhostOrigin,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  writeJson,
} from './transport-http-helpers.mts'

import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node'
import type { AuthInfo } from '@modelcontextprotocol/server'
import type { ServerConfig } from './server.mts'
import type { IncomingMessage, ServerResponse } from 'node:http'

const logger = getDefaultLogger()

// Cap a single buffered request body. MCP JSON-RPC requests are small; this
// bounds memory against an unbounded/streaming body (DoS).
const MAX_MCP_REQUEST_BODY_BYTES = 4 * 1024 * 1024

// How long an over-cap upload may keep draining after it has been refused,
// so the client can finish writing and read the 413. Past this the socket is
// closed regardless — a client that never ends must not hold it open.
const OVERSIZED_BODY_DRAIN_MS = 5000

// Our internal type accepts `auth: undefined` explicitly so callers can
// pass an undefined-stamped request without ceremony (spread, conditional
// assignment, etc.).
export type AuthenticatedRequest = IncomingMessage & {
  auth?: AuthInfo | undefined
}

// The request shape the MCP adapter accepts. It types `auth` as the stricter
// `auth?: AuthInfo` (no `| undefined`) and `method` / `url` as plain optional
// strings, while @types/node types the latter two `string | undefined` — which
// exactOptionalPropertyTypes refuses. Node always sets both on a server
// request, so re-state them and pair to the SDK's own parameter type at the
// call boundary rather than widening the local AuthenticatedRequest.
export type McpHandleRequest = Parameters<NodeMcpRequestHandler>[0]

export interface HttpTransportConfig extends ServerConfig {
  // Permit a loopback OAuth issuer. Off by default so the SSRF guard on the
  // issuer + introspection endpoint stays closed outside a local dev stack.
  oauthAllowLocalIssuer?: boolean | undefined
  oauthClientId: string
  oauthClientSecret: string
  oauthIssuer: string
  // Reject an active token whose introspection response carries no `aud` claim.
  // Off by default: an authorization server that never emits the claim would
  // otherwise fail every request. A PRESENT `aud` naming another resource is
  // rejected either way.
  oauthRequireAudience?: boolean | undefined
  oauthRequiredScopes: readonly string[]
  port: number
  trustProxy: boolean
}

/**
 * Parse a buffered body when there is one, log a 2025-era initialize, and hand
 * the request to the MCP handler. Wrapped in `handleRequestSafely` so a parse
 * failure or a handler throw becomes a JSON-RPC -32603 rather than a dead
 * socket. `peer` is the Origin, or the Host when the client sent no Origin.
 */
export async function dispatchToMcp(
  mcpHandler: NodeMcpRequestHandler,
  req: AuthenticatedRequest,
  res: ServerResponse,
  body: string | undefined,
  peer: string,
): Promise<void> {
  await handleRequestSafely(req.method ?? 'GET', res, logger, async () => {
    const parsedBody: unknown = body ? JSON.parse(body) : undefined
    if (parsedBody !== undefined && isInitializeRequest(parsedBody)) {
      const clientInfo = parsedBody.params?.clientInfo
      logger.info(
        `Client connected: ${clientInfo?.name || 'unknown'} v${clientInfo?.version || 'unknown'} from ${peer}`,
      )
    }
    const mcpReq = Object.assign(req, {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
    }) as McpHandleRequest
    await mcpHandler(mcpReq, res, parsedBody)
  })
}

/**
 * Buffer a request body under the byte cap.
 *
 * The MCP adapter reads the request stream itself and enforces no size limit,
 * so the body is buffered here and handed over pre-parsed — with a parsed body
 * the adapter reads nothing from `req`.
 *
 * Resolves `undefined` when the caller must not dispatch: either the body blew
 * the cap and a 413 was written, or the client went away mid-upload. The cap is
 * measured in raw BYTES, not decoded string length — a multibyte payload
 * carries up to 4 bytes per JS character, so a char-length check would let a
 * body several times the cap through.
 */
export function readCappedRequestBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string | undefined> {
  return new Promise<string | undefined>(resolve => {
    let body = ''
    let bytes = 0
    let settled = false
    const settle = (value: string | undefined) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    req.on('data', (chunk: string | Buffer) => {
      if (settled) {
        return
      }
      bytes +=
        typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      if (bytes > MAX_MCP_REQUEST_BODY_BYTES) {
        body = ''
        // The buffer is already released and every later chunk is dropped, so
        // memory is bounded from here on. The socket still has to survive
        // long enough for the client to READ the 413: it is typically still
        // mid-upload, and tearing the socket down — even after the response
        // flushes — resets its pending writes, so it reports a connection
        // error instead of the refusal. Announce the close, answer, then let
        // the rest of the upload drain into the void. A client that never
        // ends cannot hold the socket: the unref'd backstop closes it.
        res.setHeader('Connection', 'close')
        writeJson(res, 413, {
          error: `Request body exceeds ${MAX_MCP_REQUEST_BODY_BYTES}-byte limit.`,
        })
        settle(undefined)
        req.resume()
        const backstop = setTimeout(() => {
          req.destroy()
        }, OVERSIZED_BODY_DRAIN_MS)
        backstop.unref()
        req.once('end', () => {
          clearTimeout(backstop)
        })
        return
      }
      body += chunk.toString()
    })
    req.on('end', () => {
      settle(body)
    })
    // A client that disconnects mid-upload never fires 'end'; settle so the
    // awaiting handler doesn't hang on a promise nobody can resolve.
    req.on('close', () => {
      settle(undefined)
    })
  })
}

export async function runHttpTransport(
  config: HttpTransportConfig,
): Promise<void> {
  const oauthEnabled = Boolean(
    config.oauthIssuer && config.oauthClientId && config.oauthClientSecret,
  )
  const introspector = oauthEnabled
    ? new OAuthIntrospector(
        config.oauthIssuer,
        config.oauthClientId,
        config.oauthClientSecret,
        config.oauthRequiredScopes,
        logger,
        {
          allowLocalIssuer: config.oauthAllowLocalIssuer ?? false,
          requireAudience: config.oauthRequireAudience ?? false,
        },
      )
    : undefined

  if (introspector) {
    try {
      await introspector.loadMetadata()
      logger.info(
        `Enabled OAuth-backed MCP auth with issuer ${config.oauthIssuer}`,
      )
    } catch (e) {
      // loadMetadata only throws Error subclasses (httpRequest /
      // parseJsonObject / explicit throws); read .message directly.
      logger.error(
        `Failed to initialize OAuth metadata: ${(e as Error).message}`,
      )
      throw e
    }
  }

  // One handler for the process. It calls the factory per exchange and closes
  // the instance afterwards, so a factory — not a shared instance — is what
  // gets passed in. Serving is stateless: there is no session table, and the
  // 2025-era session operations (GET, DELETE) are answered by the handler's own
  // 405 rather than a hand-rolled session map.
  const mcpHandler = toNodeHandler(
    createMcpHandler(() => createConfiguredServer(config), {
      onerror: error => {
        logger.error(`MCP request failed: ${errorMessage(error)}`)
      },
    }),
    {
      onerror: error => {
        logger.error(`MCP adapter failed: ${errorMessage(error)}`)
      },
    },
  )

  const allowedOrigins = [
    'https://mcp.socket.dev',
    'https://mcp.socket-staging.dev',
  ] as const
  const allowedHosts = allowedOrigins.map(o => new URL(o).hostname)

  const httpServer = createServer(async (req, res) => {
    const authenticatedReq = req as AuthenticatedRequest
    let url: URL
    try {
      url = new URL(req.url!, `http://localhost:${config.port}`)
    } catch (e) {
      logger.warn(`Invalid URL in request: ${req.url} - ${errorMessage(e)}`)
      writeJson(res, 400, {
        error: { code: -32_000, message: 'Bad Request: Invalid URL' },
        id: undefined,
        jsonrpc: '2.0',
      })
      return
    }

    if (url.pathname === '/health') {
      writeJson(res, 200, {
        service: 'socket-mcp',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: config.version,
      })
      return
    }

    const origin = getRequestHeaderValue(req.headers.origin).trim()
    const host = getRequestHeaderValue(req.headers.host).trim()
    const peer = origin || host
    const isAllowedHost =
      host === `localhost:${config.port}` ||
      host === `127.0.0.1:${config.port}` ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      allowedHosts.includes(host)
    const isValidOrigin = origin
      ? isLocalhostOrigin(origin) ||
        (allowedOrigins as readonly string[]).includes(origin)
      : isAllowedHost

    if (!isValidOrigin) {
      logger.warn(
        `Rejected request from invalid origin: ${origin || 'missing'} (host: ${host})`,
      )
      writeJson(res, 403, {
        error: { code: -32_000, message: 'Forbidden: Invalid origin' },
        id: undefined,
        jsonrpc: '2.0',
      })
      return
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, DELETE, OPTIONS',
      )
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Accept, Mcp-Session-Id',
      )
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Mcp-Session-Id, WWW-Authenticate',
      )
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    const baseUrl = getRequestBaseUrl(req, config.port, config.trustProxy)

    if (
      introspector &&
      url.pathname === OAUTH_PROTECTED_RESOURCE_METADATA_PATH
    ) {
      // The configured issuer is what gets published: discovery already refused
      // any document whose own `issuer` differed, so the two agree.
      writeJson(
        res,
        200,
        buildProtectedResourceMetadata(
          baseUrl,
          config.oauthIssuer,
          config.oauthRequiredScopes,
        ),
      )
      return
    }

    if (url.pathname !== '/') {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    // Some clients (e.g. Cursor) omit the required Accept value; patch it
    // before the SDK rejects with 406.
    const accept = req.headers.accept || ''
    if (
      !accept.includes('application/json') ||
      !accept.includes('text/event-stream')
    ) {
      const requiredAccept = 'application/json, text/event-stream'
      req.headers.accept = requiredAccept
      const idx = req.rawHeaders.findIndex(h => h.toLowerCase() === 'accept')
      if (idx !== -1) {
        req.rawHeaders[idx + 1] = requiredAccept
      } else {
        req.rawHeaders.push('Accept', requiredAccept)
      }
    }

    // Auth runs on every request and fails closed: nothing past this point is
    // reachable without a bearer the introspector accepted, minted for THIS
    // resource. There is no unauthenticated fall-through to the operator's own
    // token.
    if (introspector) {
      const authResult = await introspector.authenticateRequest(
        authenticatedReq,
        res,
        baseUrl,
      )
      if (!authResult.ok) {
        return
      }
    }

    // GET carries no body, so it goes straight to the handler, which answers
    // the 2025-era standalone-stream request with its own 405.
    if (req.method === 'GET') {
      await dispatchToMcp(mcpHandler, authenticatedReq, res, undefined, peer)
      return
    }

    if (req.method === 'DELETE' || req.method === 'POST') {
      const body = await readCappedRequestBody(req, res)
      if (body === undefined) {
        return
      }
      await dispatchToMcp(mcpHandler, authenticatedReq, res, body, peer)
      return
    }

    res.writeHead(405)
    res.end('Method not allowed')
  })

  // Without OAuth introspection there is no per-client authentication, so
  // bind to loopback only — an unauthenticated server must not be reachable
  // from the network (the Host-header origin check is spoofable by non-browser
  // clients and is not an auth boundary). When OAuth is enabled, clients are
  // authenticated, so binding to all interfaces is intentional.
  const listenHost = introspector ? undefined : '127.0.0.1'
  await new Promise<void>(resolve => {
    const onListening = () => {
      logger.info(
        `Socket MCP HTTP server version ${config.version} started successfully on port ${config.port}${listenHost ? ` (bound to ${listenHost})` : ''}`,
      )
      logger.info(`Connect to: http://localhost:${config.port}/`)
      resolve()
    }
    if (listenHost) {
      httpServer.listen(config.port, listenHost, onListening)
    } else {
      httpServer.listen(config.port, onListening)
    }
  })
}
