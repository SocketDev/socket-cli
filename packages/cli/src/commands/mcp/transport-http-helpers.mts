import { httpRequest } from '@socketsecurity/lib/http-request'

import type { HttpResponse } from '@socketsecurity/lib/http-request'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface OAuthMetadata {
  authorization_endpoint: string
  introspection_endpoint: string
  issuer: string
  token_endpoint: string
  [key: string]: unknown
}

export const OAUTH_WELL_KNOWN_PATH = '/.well-known/oauth-authorization-server'
export const OAUTH_PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource'

type AuthenticatedRequest = IncomingMessage & { auth?: AuthInfo | undefined }

export class OAuthIntrospector {
  private metadataPromise: Promise<OAuthMetadata> | undefined
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly issuer: string
  private readonly requiredScopes: readonly string[]
  private readonly log: { error: (msg: string) => void }
  constructor(
    issuer: string,
    clientId: string,
    clientSecret: string,
    requiredScopes: readonly string[],
    log: { error: (msg: string) => void },
  ) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.issuer = issuer
    this.requiredScopes = requiredScopes
    this.log = log
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
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const field of [
          'authorization_endpoint',
          'introspection_endpoint',
          'issuer',
          'token_endpoint',
        ] as const) {
          if (typeof metadata[field] !== 'string' || !metadata[field]) {
            throw new Error(`OAuth metadata missing required field: ${field}`)
          }
        }
        return metadata as OAuthMetadata
      })()
      this.metadataPromise = promise.catch(error => {
        // Failure invalidates the cache so the next call retries.
        // Safe in single-threaded JS: no other code can replace
        // `this.metadataPromise` between this catch and the next call.
        this.metadataPromise = undefined
        throw error
      })
    }
    return await this.metadataPromise
  }

  async verifyAccessToken(token: string): Promise<AuthInfo | undefined> {
    const metadata = await this.loadMetadata()
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64')
    const response: HttpResponse = await httpRequest(
      metadata.introspection_endpoint,
      {
        body: new URLSearchParams({ token }).toString(),
        headers: {
          authorization: `Basic ${basicAuth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      },
    )
    const responseText = response.text()
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Token introspection failed with status ${response.status}: ${responseText}`,
      )
    }
    const introspection = parseJsonObject(responseText, 'Token introspection')
    if (!introspection['active']) {
      return undefined
    }
    const expRaw = introspection['exp']
    const expiresAt = typeof expRaw === 'number' ? expRaw : Number(expRaw)
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
    // `authHeader` is non-empty (guarded above), so split always
    // yields at least one element — `parts[0]` is always a string.
    const parts = authHeader.split(/\s+/u)
    const type = parts[0]!
    const token = parts[1]
    if (type.toLowerCase() !== 'bearer' || !token) {
      writeOAuthError(
        res,
        401,
        'invalid_request',
        "Invalid Authorization header format, expected 'Bearer TOKEN'",
        resourceMetadataUrl,
      )
      return { ok: false }
    }
    let authInfo: AuthInfo | undefined
    try {
      authInfo = await this.verifyAccessToken(token)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.log.error(`Token verification failed: ${message}`)
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

export function buildProtectedResourceMetadata(
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

/**
 * Destroy a session by id. Closes the transport (catching synchronous
 * throws) and the server (swallowing async rejections), then deletes
 * the session entry and logs.
 *
 * The transport-close try/catch and the server-close `.catch()` are
 * here because the SDK's close path can fault when called during an
 * already-closing connection (e.g. client disconnect mid-stream); we
 * want destroySession to be safe to call repeatedly without
 * propagating those races.
 */
export interface SessionLike {
  lastActivity: number
  server: { close(): Promise<unknown> }
  transport: { close(): void }
}

export function destroySessionEntry<T extends SessionLike>(
  id: string,
  sessions: Map<string, T>,
  log: { info: (msg: string) => void },
): void {
  const s = sessions.get(id)
  if (!s) {
    return
  }
  sessions.delete(id)
  try {
    s.transport.close()
  } catch {}
  s.server.close().catch(() => {})
  log.info(`Session ${id} destroyed`)
}

export function getForwardedHeaderValue(
  header: string | string[] | undefined,
): string {
  return getRequestHeaderValue(header).split(',', 1)[0]?.trim() || ''
}

export function getProtectedResourceMetadataUrl(baseUrl: URL): string {
  return new URL(OAUTH_PROTECTED_RESOURCE_METADATA_PATH, baseUrl).href
}

export function getRequestBaseUrl(
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
  const socketWithTls = req.socket as { encrypted?: boolean | undefined }
  const protocol =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : socketWithTls.encrypted
        ? 'https'
        : 'http'
  return new URL(`${protocol}://${host}/`)
}

export function getRequestHeaderValue(
  header: string | string[] | undefined,
): string {
  if (Array.isArray(header)) {
    return header[0] || ''
  }
  return header || ''
}

/**
 * Run a request handler, surfacing failures as a JSON-RPC -32603
 * (Internal server error). Used by the GET / DELETE / POST flows so
 * a transport-level exception doesn't kill the connection without a
 * client-readable response. If the response has already started
 * streaming (`res.headersSent`), nothing is written — the SDK is in
 * the middle of producing output and another writeHead would crash
 * the worker.
 */
export async function handleRequestSafely(
  label: string,
  res: ServerResponse,
  log: { error: (msg: string) => void },
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn()
  } catch (e) {
    log.error(`Error processing ${label} request: ${e}`)
    if (!res.headersSent) {
      writeJson(res, 500, {
        error: { code: -32603, message: 'Internal server error' },
        id: undefined,
        jsonrpc: '2.0',
      })
    }
  }
}

export function isLocalhostOrigin(originUrl: string): boolean {
  try {
    const u = new URL(originUrl)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return false
  }
}

/**
 * Build the `transport.onclose` handler that destroys the session
 * keyed by the transport's sessionId. The `if (sessionId)` guard
 * matters because onclose can fire before onsessioninitialized has
 * assigned a sessionId (e.g. SDK init failure on a brand-new transport).
 */
export function makeOnTransportClose(
  getSessionId: () => string | undefined,
  destroy: (id: string) => void,
): () => void {
  return () => {
    const id = getSessionId()
    if (id) {
      destroy(id)
    }
  }
}

export function parseJsonObject(
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

/**
 * Walk a session map and destroy entries whose lastActivity is older
 * than `ttlMs`. Used by the periodic reaper interval.
 */
export function reapIdleSessions<T extends { lastActivity: number }>(
  now: number,
  ttlMs: number,
  sessions: Map<string, T>,
  destroy: (id: string) => void,
  log: { info: (msg: string) => void },
): void {
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivity > ttlMs) {
      log.info(`Reaping idle session ${id}`)
      destroy(id)
    }
  }
}

export function splitScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') {
    return []
  }
  return scope
    .split(/\s+/u)
    .map(value => value.trim())
    .filter(Boolean)
}

export function writeJson(
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

export function writeOAuthError(
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
