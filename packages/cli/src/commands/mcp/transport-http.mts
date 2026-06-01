import crypto from 'node:crypto'
import { createServer } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { createConfiguredServer } from './server.mts'
import {
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  OAuthIntrospector,
  buildProtectedResourceMetadata,
  destroySessionEntry,
  getProtectedResourceMetadataUrl,
  getRequestBaseUrl,
  getRequestHeaderValue,
  handleRequestSafely,
  isLocalhostOrigin,
  makeOnTransportClose,
  reapIdleSessions,
  writeJson,
} from './transport-http-helpers.mts'

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { ServerConfig } from './server.mts'
import type { IncomingMessage } from 'node:http'

const logger = getDefaultLogger()

const SESSION_TTL_MS = 30 * 60 * 1000
const SESSION_REAP_INTERVAL_MS = 60_000

// Our internal type accepts `auth: undefined` explicitly so callers can
// pass an undefined-stamped request without ceremony (spread, conditional
// assignment, etc.).
type AuthenticatedRequest = IncomingMessage & { auth?: AuthInfo | undefined }

// MCP's `transport.handleRequest()` parameter is the stricter
// `auth?: AuthInfo` (no `| undefined`) under our
// exactOptionalPropertyTypes. Cast our internal type to this at the
// call boundary when handing off; that's the narrow constraint, not
// our internal shape.
// oxlint-disable-next-line socket/optional-explicit-undefined -- SDK target type uses `auth?: AuthInfo` (no `| undefined`); under exactOptionalPropertyTypes the bare-undefined form rejects this assignment. Pair to the SDK shape, not the local AuthenticatedRequest.
type McpHandleRequest = IncomingMessage & { auth?: AuthInfo }

interface Session {
  lastActivity: number
  server: Server
  transport: StreamableHTTPServerTransport
}

interface HttpTransportConfig extends ServerConfig {
  oauthClientId: string
  oauthClientSecret: string
  oauthIssuer: string
  oauthRequiredScopes: readonly string[]
  port: number
  trustProxy: boolean
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

  const sessions = new Map<string, Session>()

  const destroySession = (id: string): void =>
    destroySessionEntry(id, sessions, logger)

  const tickReaper = () =>
    reapIdleSessions(
      Date.now(),
      SESSION_TTL_MS,
      sessions,
      destroySession,
      logger,
    )
  // First tick runs immediately — the session map is empty so this is
  // a no-op, but it gives the test surface a deterministic way to
  // invoke the reaper (and gives coverage tools a one-shot through
  // the function body).
  tickReaper()
  const reapInterval = setInterval(tickReaper, SESSION_REAP_INTERVAL_MS)
  reapInterval.unref()

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
      logger.warn(`Invalid URL in request: ${req.url} - ${e}`)
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
      // loadMetadata is memoized after the successful startup probe,
      // so this resolves synchronously from cache.
      const metadata = await introspector.loadMetadata()
      writeJson(
        res,
        200,
        buildProtectedResourceMetadata(
          baseUrl,
          metadata,
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

    if (introspector) {
      const authResult = await introspector.authenticateRequest(
        authenticatedReq,
        res,
        getProtectedResourceMetadataUrl(baseUrl),
      )
      if (!authResult.ok) {
        return
      }
    }

    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: string | Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () =>
        handleRequestSafely('POST', res, logger, async () => {
          const jsonData = JSON.parse(body)
          const sessionId =
            getRequestHeaderValue(req.headers['mcp-session-id']) || undefined
          const session = sessionId ? sessions.get(sessionId) : undefined
          let transport = session?.transport

          if (!transport && isInitializeRequest(jsonData)) {
            const clientInfo = jsonData.params?.clientInfo
            logger.info(
              `Client connected: ${clientInfo?.name || 'unknown'} v${clientInfo?.version || 'unknown'} from ${origin || host}`,
            )
            const server = createConfiguredServer(config)
            const newTransport = new StreamableHTTPServerTransport({
              enableJsonResponse: true,
              onsessionclosed: id => {
                destroySession(id)
              },
              onsessioninitialized: id => {
                sessions.set(id, {
                  lastActivity: Date.now(),
                  server,
                  transport: newTransport,
                })
              },
              sessionIdGenerator: () => crypto.randomUUID(),
            })
            // eslint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK exposes onclose as a setter, not an EventTarget.
            newTransport.onclose = makeOnTransportClose(
              () => newTransport.sessionId,
              destroySession,
            )
            transport = newTransport
            await server.connect(transport as Transport)
          }

          if (!transport) {
            writeJson(res, 400, {
              error: {
                code: -32_000,
                message:
                  'Bad Request: No valid session. Send initialize first.',
              },
              id: undefined,
              jsonrpc: '2.0',
            })
            return
          }

          if (sessionId) {
            const activeSession = sessions.get(sessionId)
            if (activeSession) {
              activeSession.lastActivity = Date.now()
            }
          }

          await transport.handleRequest(
            authenticatedReq as McpHandleRequest,
            res,
            jsonData,
          )
        }),
      )
      return
    }

    if (req.method === 'GET') {
      const sessionId =
        getRequestHeaderValue(req.headers['mcp-session-id']) || undefined
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (!session) {
        writeJson(res, 404, {
          error: {
            code: -32_000,
            message: 'Not Found: Invalid or expired session. Re-initialize.',
          },
          id: undefined,
          jsonrpc: '2.0',
        })
        return
      }
      await handleRequestSafely('GET', res, logger, async () => {
        session.lastActivity = Date.now()
        await session.transport.handleRequest(
          authenticatedReq as McpHandleRequest,
          res,
        )
      })
      return
    }

    if (req.method === 'DELETE') {
      const sessionId =
        getRequestHeaderValue(req.headers['mcp-session-id']) || undefined
      const transport = sessionId
        ? sessions.get(sessionId)?.transport
        : undefined
      if (!transport) {
        writeJson(res, 404, {
          error: {
            code: -32_000,
            message: 'Not Found: Invalid or expired session.',
          },
          id: undefined,
          jsonrpc: '2.0',
        })
        return
      }
      await handleRequestSafely('DELETE', res, logger, async () => {
        await transport.handleRequest(authenticatedReq as McpHandleRequest, res)
      })
      return
    }

    res.writeHead(405)
    res.end('Method not allowed')
  })

  await new Promise<void>(resolve => {
    httpServer.listen(config.port, () => {
      logger.info(
        `Socket MCP HTTP server version ${config.version} started successfully on port ${config.port}`,
      )
      logger.info(`Connect to: http://localhost:${config.port}/`)
      resolve()
    })
  })
}
