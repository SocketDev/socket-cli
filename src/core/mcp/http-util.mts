/**
 * Transport-level helpers shared by the `socket mcp` HTTP server: request
 * header / base-URL reading, JSON and RFC 6750 error responses, and the RFC
 * 9728 protected-resource metadata this server publishes.
 *
 * Discovery lives in `oauth-discovery.mts`; the bearer pipeline lives in
 * `oauth-introspector.mts`.
 */

import { resourceUrlFromServerUrl } from '@modelcontextprotocol/server'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import type { AuthInfo } from '@modelcontextprotocol/server'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const OAUTH_PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource'

// Even under trustProxy, X-Forwarded-Host must be a bare host[:port]. A value
// carrying a scheme, userinfo, or a path would smuggle a different origin into
// the OAuth metadata URLs this server advertises.
const FORWARDED_HOST_RE = /^[a-z0-9.-]+(?::\d+)?$/iu

// RFC 6749 §3.3 reserves no meaning for `offline_access` on a resource server.
// It is an OIDC refresh-token request scope, not something a resource server
// requires of an access token, so it never reaches `scopes_supported` or a
// WWW-Authenticate challenge.
const NON_RESOURCE_SCOPES = new Set(['offline_access'])

export type AuthenticatedRequest = IncomingMessage & {
  auth?: AuthInfo | undefined
}

/**
 * The scopes this resource advertises and enforces: the operator's configured
 * list minus scopes that are meaningless on a resource server.
 */
export function buildOAuthResourceScopes(
  requiredScopes: readonly string[],
): string[] {
  return requiredScopes.filter(scope => !NON_RESOURCE_SCOPES.has(scope))
}

/**
 * The `scope` parameter for a WWW-Authenticate challenge: the space-delimited
 * list of scopes this resource requires. Empty when no scope is enforced, in
 * which case the challenge omits the parameter.
 */
export function buildOAuthScopeParameter(
  requiredScopes: readonly string[],
): string {
  return buildOAuthResourceScopes(requiredScopes).join(' ')
}

/**
 * RFC 9728 protected-resource metadata. `authorization_servers` publishes the
 * CONFIGURED issuer: discovery has already refused any document whose own
 * `issuer` differs, so config and document agree and sourcing from config makes
 * that invariant plain. `bearer_methods_supported` names only `header` because
 * the Authorization header is the sole form this server reads.
 */
export function buildProtectedResourceMetadata(
  baseUrl: URL,
  issuer: string,
  requiredScopes: readonly string[],
): Record<string, unknown> {
  return {
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    resource: getOAuthResourceIdentifier(baseUrl).href,
    resource_name: 'Socket MCP Server',
    scopes_supported: buildOAuthResourceScopes(requiredScopes),
  }
}

export function getForwardedHeaderValue(
  header: string | string[] | undefined,
): string {
  return getRequestHeaderValue(header).split(',', 1)[0]?.trim() || ''
}

/**
 * The RFC 8707 resource identifier this server answers for. Derived from the
 * request's base URL so it matches the `resource` value
 * `buildProtectedResourceMetadata` publishes — the audience check and the
 * published identifier cannot drift because they call the same function.
 */
export function getOAuthResourceIdentifier(baseUrl: URL): URL {
  return resourceUrlFromServerUrl(new URL('/', baseUrl))
}

export function getProtectedResourceMetadataUrl(baseUrl: URL): string {
  return new URL(OAUTH_PROTECTED_RESOURCE_METADATA_PATH, baseUrl).href
}

// Collapsing into an options object would change call sites in
// transport-http.mts + transport-http-helpers.test.mts, out of scope for this
// pass.
export function getRequestBaseUrl(
  req: IncomingMessage,
  fallbackPort: number,
  // oxlint-disable-next-line socket/no-boolean-trap-param -- out of scope
  trustProxy: boolean,
): URL {
  const forwardedProto = trustProxy
    ? getForwardedHeaderValue(req.headers['x-forwarded-proto']).toLowerCase()
    : ''
  const forwardedHostRaw = trustProxy
    ? getForwardedHeaderValue(req.headers['x-forwarded-host'])
    : ''
  const forwardedHost = FORWARDED_HOST_RE.test(forwardedHostRaw)
    ? forwardedHostRaw
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
 * Run a request handler, surfacing failures as a JSON-RPC -32603 (Internal
 * server error). Used by the GET / DELETE / POST flows so a transport-level
 * exception doesn't kill the connection without a client-readable response. If
 * the response has already started streaming (`res.headersSent`), nothing is
 * written — the SDK is in the middle of producing output and another writeHead
 * would crash the worker.
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
    log.error(`Error processing ${label} request: ${errorMessage(e)}`)
    if (!res.headersSent) {
      writeJson(res, 500, {
        error: { code: -32_603, message: 'Internal server error' },
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

export function parseJsonObject(
  responseText: string,
  context: string,
): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch (e) {
    const message = errorMessage(e)
    throw new Error(`${context} returned invalid JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${context} returned invalid JSON: expected a JSON object`)
  }
  return parsed as Record<string, unknown>
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
  scope?: string | undefined,
): void {
  const params = [
    `error="${errorCode}"`,
    `error_description="${message}"`,
    ...(resourceMetadataUrl
      ? [`resource_metadata="${resourceMetadataUrl}"`]
      : []),
    ...(scope ? [`scope="${scope}"`] : []),
  ]
  writeJson(
    res,
    statusCode,
    {
      error: errorCode,
      error_description: message,
    },
    { 'WWW-Authenticate': `Bearer ${params.join(', ')}` },
  )
}
