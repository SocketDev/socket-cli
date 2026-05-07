import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import { httpRequest } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import type { HttpResponse } from '@socketsecurity/lib/http-request'

import { createConfiguredServer } from './server.mts'

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { ServerConfig } from './server.mts'
import type { IncomingMessage, ServerResponse } from 'node:http'

const logger = getDefaultLogger()

const OAUTH_WELL_KNOWN_PATH = '/.well-known/oauth-authorization-server'
const OAUTH_PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'
const SESSION_TTL_MS = 30 * 60 * 1000
const SESSION_REAP_INTERVAL_MS = 60_000

interface OAuthMetadata {
  authorization_endpoint: string
  introspection_endpoint: string
  issuer: string
  token_endpoint: string
  [key: string]: unknown
}

type AuthenticatedRequest = IncomingMessage & { auth?: AuthInfo }

interface Session {
  lastActivity: number
  server: Server
  transport: StreamableHTTPServerTransport
}

export interface HttpTransportConfig extends ServerConfig {
  oauthClientId: string
  oauthClientSecret: string
  oauthIssuer: string
  oauthRequiredScopes: readonly string[]
  port: number
  trustProxy: boolean
}

function getRequestHeaderValue(
  header: string | string[] | undefined,
): string {
  if (Array.isArray(header)) {
    return header[0] || ''
  }
  return header || ''
}

function getForwardedHeaderValue(
  header: string | string[] | undefined,
): string {
  return (
    getRequestHeaderValue(header).split(',', 1)[0]?.trim() || ''
  )
}

function getRequestBaseUrl(
  req: IncomingMessage,
  fallbackPort: number,
  trustProxy: boolean,
): URL {
  const forwardedProto = trustProxy
    ? getForwardedHeaderValue(req.headers['x-forwarded-proto']).toLowerCase()
    : ''
  const forwardedHost = trustProxy
    ? getForwardedHeaderValue(req.headers['x-forwarded-host'])
    : ''
  const host =
    forwardedHost ||
    getRequestHeaderValue(req.headers.host).trim() ||
    `localhost:${fallbackPort}`
  const socketWithTls = req.socket as { encrypted?: boolean }
  const protocol =
    forwardedProto === 'https' || forwardedProto === 'http'
      ? forwardedProto
      : socketWithTls.encrypted
        ? 'https'
        : 'http'
  return new URL(`${protocol}://${host}/`)
}

function parseJsonObject(
  responseText: string,
  context: string,
): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`${context} returned invalid JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${context} returned invalid JSON: expected a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function getProtectedResourceMetadataUrl(baseUrl: URL): string {
  return new URL(OAUTH_PROTECTED_RESOURCE_METADATA_PATH, baseUrl).href
}

function buildProtectedResourceMetadata(
  baseUrl: URL,
  oauthMetadata: OAuthMetadata,
  requiredScopes: readonly string[],
): Record<string, unknown> {
  return {
    authorization_servers: [oauthMetadata.issuer],
    resource: new URL('/', baseUrl).href,
    resource_name: 'Socket MCP Server',
    scopes_supported: requiredScopes,
  }
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function writeOAuthError(
  res: ServerResponse,
  statusCode: number,
  errorCode: string,
  message: string,
  resourceMetadataUrl?: string | undefined,
): void {
  const authenticateValue = resourceMetadataUrl
    ? `Bearer error="${errorCode}", error_description="${message}", resource_metadata="${resourceMetadataUrl}"`
    : `Bearer error="${errorCode}", error_description="${message}"`
  writeJson(
    res,
    statusCode,
    {
      error: errorCode,
      error_description: message,
    },
    { 'WWW-Authenticate': authenticateValue },
  )
}

function splitScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') {
    return []
  }
  return scope
    .split(/\s+/u)
    .map(value => value.trim())
    .filter(Boolean)
}

class OAuthIntrospector {
  private metadataPromise: Promise<OAuthMetadata> | undefined
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly issuer: string
  private readonly requiredScopes: readonly string[]
  constructor(
    issuer: string,
    clientId: string,
    clientSecret: string,
    requiredScopes: readonly string[],
  ) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.issuer = issuer
    this.requiredScopes = requiredScopes
  }

  async loadMetadata(): Promise<OAuthMetadata> {
    if (!this.metadataPromise) {
      const promise = (async () => {
        const issuerUrl = new URL(this.issuer)
        const url = new URL(OAUTH_WELL_KNOWN_PATH, issuerUrl).href
        const response: HttpResponse = await httpRequest(url, { method: 'GET' })
        const responseText = response.text()
        if (response.status < 200 || response.status >= 300) {
          throw new Error(
            `OAuth metadata discovery failed with status ${response.status}: ${responseText}`,
          )
        }
        const metadata = parseJsonObject(
          responseText,
          'OAuth metadata discovery',
        )
        for (const field of [
          'authorization_endpoint',
          'introspection_endpoint',
          'issuer',
          'token_endpoint',
        ] as const) {
          if (typeof metadata[field] !== 'string' || !metadata[field]) {
            throw new Error(
              `OAuth metadata missing required field: ${field}`,
            )
          }
        }
        return metadata as OAuthMetadata
      })()
      const retryable = promise.catch(error => {
        if (this.metadataPromise === retryable) {
          this.metadataPromise = undefined
        }
        throw error
      })
      this.metadataPromise = retryable
    }
    return await this.metadataPromise
  }

  async verifyAccessToken(token: string): Promise<AuthInfo | null> {
    const metadata = await this.loadMetadata()
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64')
    const response: HttpResponse = await httpRequest(metadata.introspection_endpoint, {
      body: new URLSearchParams({ token }).toString(),
      headers: {
        authorization: `Basic ${basicAuth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    })
    const responseText = response.text()
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Token introspection failed with status ${response.status}: ${responseText}`,
      )
    }
    const introspection = parseJsonObject(responseText, 'Token introspection')
    if (!introspection['active']) {
      return null
    }
    const expRaw = introspection['exp']
    const expiresAt =
      typeof expRaw === 'number' ? expRaw : Number(expRaw)
    return {
      clientId:
        typeof introspection['client_id'] === 'string'
          ? introspection['client_id']
          : 'unknown',
      extra: introspection,
      scopes: splitScopes(introspection['scope']),
      token,
      ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
    }
  }

  async authenticateRequest(
    req: AuthenticatedRequest,
    res: ServerResponse,
    resourceMetadataUrl: string,
  ): Promise<{ authInfo: AuthInfo; ok: true } | { ok: false }> {
    const authHeader = getRequestHeaderValue(req.headers.authorization).trim()
    if (!authHeader) {
      writeOAuthError(
        res,
        401,
        'invalid_request',
        'Missing Authorization header',
        resourceMetadataUrl,
      )
      return { ok: false }
    }
    const [type, token] = authHeader.split(/\s+/u)
    if ((type || '').toLowerCase() !== 'bearer' || !token) {
      writeOAuthError(
        res,
        401,
        'invalid_request',
        "Invalid Authorization header format, expected 'Bearer TOKEN'",
        resourceMetadataUrl,
      )
      return { ok: false }
    }
    let authInfo: AuthInfo | null
    try {
      authInfo = await this.verifyAccessToken(token)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error(`Token verification failed: ${message}`)
      writeJson(res, 500, {
        error: 'server_error',
        error_description: 'Token verification failed',
      })
      return { ok: false }
    }
    if (!authInfo) {
      writeOAuthError(
        res,
        401,
        'invalid_token',
        'Invalid or expired token',
        resourceMetadataUrl,
      )
      return { ok: false }
    }
    if (
      typeof authInfo.expiresAt === 'number' &&
      authInfo.expiresAt < Date.now() / 1000
    ) {
      writeOAuthError(
        res,
        401,
        'invalid_token',
        'Token has expired',
        resourceMetadataUrl,
      )
      return { ok: false }
    }
    const missing = this.requiredScopes.filter(
      s => !authInfo!.scopes.includes(s),
    )
    if (missing.length > 0) {
      writeOAuthError(
        res,
        403,
        'insufficient_scope',
        `Missing required scopes: ${missing.join(', ')}`,
        resourceMetadataUrl,
      )
      return { ok: false }
    }
    req.auth = authInfo
    return { authInfo, ok: true }
  }
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
      )
    : undefined

  if (introspector) {
    try {
      await introspector.loadMetadata()
      logger.info(
        `Enabled OAuth-backed MCP auth with issuer ${config.oauthIssuer}`,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error(`Failed to initialize OAuth metadata: ${message}`)
      throw e
    }
  }

  const sessions = new Map<string, Session>()

  const destroySession = (id: string): void => {
    const s = sessions.get(id)
    if (!s) {
      return
    }
    sessions.delete(id)
    try {
      s.transport.close()
    } catch {}
    s.server.close().catch(() => {})
    logger.info(`Session ${id} destroyed`)
  }

  const reapInterval = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        logger.info(`Reaping idle session ${id}`)
        destroySession(id)
      }
    }
  }, SESSION_REAP_INTERVAL_MS)
  reapInterval.unref()

  const allowedOrigins = [
    'https://mcp.socket.dev',
    'https://mcp.socket-staging.dev',
  ] as const
  const allowedHosts = allowedOrigins.map(o => new URL(o).hostname)

  const isLocalhostOrigin = (originUrl: string): boolean => {
    try {
      const u = new URL(originUrl)
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    } catch {
      return false
    }
  }

  const httpServer = createServer(async (req, res) => {
    const authenticatedReq = req as AuthenticatedRequest
    let url: URL
    try {
      url = new URL(req.url!, `http://localhost:${config.port}`)
    } catch (e) {
      logger.warn(`Invalid URL in request: ${req.url} - ${e}`)
      writeJson(res, 400, {
        error: { code: -32000, message: 'Bad Request: Invalid URL' },
        id: null,
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
        error: { code: -32000, message: 'Forbidden: Invalid origin' },
        id: null,
        jsonrpc: '2.0',
      })
      return
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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

    if (introspector && url.pathname === OAUTH_PROTECTED_RESOURCE_METADATA_PATH) {
      try {
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
      } catch {
        writeJson(res, 500, {
          error: 'server_error',
          error_description: 'OAuth metadata is unavailable',
        })
      }
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
      req.on('end', async () => {
        try {
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
              sessionIdGenerator: () => randomUUID(),
            })
            newTransport.onclose = () => {
              const id = newTransport.sessionId
              if (id) {
                destroySession(id)
              }
            }
            transport = newTransport
            await server.connect(transport as Transport)
          }

          if (!transport) {
            writeJson(res, 400, {
              error: {
                code: -32000,
                message: 'Bad Request: No valid session. Send initialize first.',
              },
              id: null,
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

          await transport.handleRequest(authenticatedReq, res, jsonData)
        } catch (e) {
          logger.error(`Error processing POST request: ${e}`)
          if (!res.headersSent) {
            writeJson(res, 500, {
              error: { code: -32603, message: 'Internal server error' },
              id: null,
              jsonrpc: '2.0',
            })
          }
        }
      })
      return
    }

    if (req.method === 'GET') {
      const sessionId =
        getRequestHeaderValue(req.headers['mcp-session-id']) || undefined
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (!session) {
        writeJson(res, 404, {
          error: {
            code: -32000,
            message: 'Not Found: Invalid or expired session. Re-initialize.',
          },
          id: null,
          jsonrpc: '2.0',
        })
        return
      }
      try {
        session.lastActivity = Date.now()
        await session.transport.handleRequest(authenticatedReq, res)
      } catch (e) {
        logger.error(`Error processing GET request: ${e}`)
        if (!res.headersSent) {
          writeJson(res, 500, {
            error: { code: -32603, message: 'Internal server error' },
            id: null,
            jsonrpc: '2.0',
          })
        }
      }
      return
    }

    if (req.method === 'DELETE') {
      const sessionId =
        getRequestHeaderValue(req.headers['mcp-session-id']) || undefined
      const transport = sessionId ? sessions.get(sessionId)?.transport : undefined
      if (!transport) {
        writeJson(res, 404, {
          error: { code: -32000, message: 'Not Found: Invalid or expired session.' },
          id: null,
          jsonrpc: '2.0',
        })
        return
      }
      try {
        await transport.handleRequest(authenticatedReq, res)
      } catch (e) {
        logger.error(`Error processing DELETE request: ${e}`)
        if (!res.headersSent) {
          writeJson(res, 500, {
            error: { code: -32603, message: 'Internal server error' },
            id: null,
            jsonrpc: '2.0',
          })
        }
      }
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
