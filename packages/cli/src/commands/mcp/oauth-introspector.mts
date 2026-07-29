/**
 * The request-time OAuth surface for the `socket mcp` HTTP server: the
 * bearer-token pipeline incoming MCP requests run through, RFC 7662
 * introspection with RFC 8707 audience validation, and the discovery cache the
 * introspection endpoint is read from.
 *
 * Discovery lives in `oauth-discovery.mts`; the protected-resource metadata
 * this server publishes lives in `transport-http-helpers.mts`.
 */

import { checkResourceAllowed } from '@modelcontextprotocol/server'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { assertSafeHttpUrl } from '@socketsecurity/lib-stable/url/assert-safe'

import { discoverOAuthMetadata } from './oauth-discovery.mts'
import {
  buildOAuthScopeParameter,
  getOAuthResourceIdentifier,
  getProtectedResourceMetadataUrl,
  getRequestHeaderValue,
  parseJsonObject,
  splitScopes,
  writeJson,
  writeOAuthError,
} from './transport-http-helpers.mts'

import type { OAuthMetadata } from './oauth-discovery.mts'
import type { AuthenticatedRequest } from './transport-http-helpers.mts'
import type { AuthInfo } from '@modelcontextprotocol/server'
import type { HttpResponse } from '@socketsecurity/lib-stable/http-request/response-types'
import type { ServerResponse } from 'node:http'

export interface OAuthIntrospectorOptions {
  // Permit a loopback issuer / introspection endpoint. Off by default: both
  // URLs are fetched server-side, so a loopback or private-range value is an
  // SSRF pivot. Only a local development stack should turn this on.
  allowLocalIssuer?: boolean | undefined
  // Reject an active token whose introspection response carries no `aud` at
  // all. Off by default, because an authorization server that never emits the
  // claim would otherwise fail every request. A PRESENT `aud` naming another
  // resource is rejected either way.
  requireAudience?: boolean | undefined
}

/**
 * Whether one `aud` entry names this resource server. An audience that is not a
 * URL at all can never match a URL resource identifier, so an unparseable value
 * fails closed rather than throwing.
 */
export function isOAuthAudienceAllowed(
  audience: string,
  resourceIdentifier: URL,
): boolean {
  try {
    return checkResourceAllowed({
      configuredResource: resourceIdentifier,
      requestedResource: audience,
    })
  } catch {
    return false
  }
}

/**
 * Read the RFC 7662 `aud` claim, which is a single string or an array of
 * strings, into a list of non-empty audience values.
 */
export function splitTokenAudience(audience: unknown): string[] {
  if (typeof audience === 'string') {
    return audience.trim() ? [audience] : []
  }
  if (Array.isArray(audience)) {
    return audience.filter(
      (value): value is string =>
        typeof value === 'string' && Boolean(value.trim()),
    )
  }
  return []
}

export class OAuthIntrospector {
  private metadataPromise: Promise<OAuthMetadata> | undefined
  private readonly allowLocalIssuer: boolean
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly issuer: string
  private readonly requireAudience: boolean
  private readonly requiredScopes: readonly string[]
  private readonly log: {
    error: (msg: string) => void
    warn?: ((msg: string) => void) | undefined
  }
  constructor(
    issuer: string,
    clientId: string,
    clientSecret: string,
    requiredScopes: readonly string[],
    log: {
      error: (msg: string) => void
      warn?: ((msg: string) => void) | undefined
    },
    options?: OAuthIntrospectorOptions | undefined,
  ) {
    const opts = { __proto__: null, ...options } as OAuthIntrospectorOptions
    this.allowLocalIssuer = opts.allowLocalIssuer ?? false
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.issuer = issuer
    this.requireAudience = opts.requireAudience ?? false
    this.requiredScopes = requiredScopes
    this.log = log
  }

  async loadMetadata(): Promise<OAuthMetadata> {
    if (!this.metadataPromise) {
      const promise = (async () => {
        // The issuer is operator-supplied. SSRF-guard it so a misconfigured
        // or hostile value can't point discovery at an internal host.
        const issuerUrl = assertSafeHttpUrl(this.issuer, {
          allowLocalhost: this.allowLocalIssuer,
          label: 'OAuth issuer',
        })
        return await discoverOAuthMetadata(issuerUrl, this.issuer)
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

  async verifyAccessToken(
    token: string,
    resourceIdentifier: URL,
  ): Promise<AuthInfo | undefined> {
    const metadata = await this.loadMetadata()
    // The introspection endpoint arrives in the issuer's metadata response, so
    // a hostile or MITM'd issuer chooses where this bearer token gets POSTed.
    // SSRF-guard it before the token leaves the box.
    const introspectionUrl = assertSafeHttpUrl(
      metadata.introspection_endpoint,
      {
        allowLocalhost: this.allowLocalIssuer,
        label: 'OAuth introspection_endpoint',
      },
    ).href
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64')
    const response: HttpResponse = await httpRequest(introspectionUrl, {
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
      return undefined
    }
    // RFC 8707 §2 / MCP: a token that names an audience is only usable here if
    // that audience is this resource. A PRESENT `aud` naming something else is
    // always rejected — that is the substitution attack, and no flag opens it.
    // An ABSENT `aud` is accepted unless the require-audience opt-in is on,
    // because an authorization server that never emits the claim would
    // otherwise fail every request.
    const audiences = splitTokenAudience(introspection['aud'])
    if (audiences.length === 0) {
      if (this.requireAudience) {
        this.warn(
          `Rejected an active token carrying no "aud" claim. Where: introspection of a request for ${resourceIdentifier.href}. Saw no audience, wanted one naming this resource. Fix: have the authorization server return "aud" on introspection, or unset SOCKET_OAUTH_REQUIRE_AUDIENCE to accept audience-less tokens.`,
        )
        return undefined
      }
    } else if (
      !audiences.some(audience =>
        isOAuthAudienceAllowed(audience, resourceIdentifier),
      )
    ) {
      this.warn(
        `Rejected a token minted for another resource. Where: introspection of a request for ${resourceIdentifier.href}. Saw aud=[${audiences.join(', ')}], wanted ${resourceIdentifier.href}. Fix: request the token with resource=${resourceIdentifier.href}.`,
      )
      return undefined
    }
    // An absent `exp` means a non-expiring token, so it is simply left off the
    // AuthInfo. A PRESENT-but-unparseable `exp` must fail CLOSED: dropping it
    // would silently promote the token to never-expiring, letting a buggy or
    // compromised introspection endpoint hand out tokens that never age out.
    const expRaw = introspection['exp']
    let expiresAt: number | undefined
    if (expRaw !== undefined && expRaw !== null) {
      const parsed = typeof expRaw === 'number' ? expRaw : Number(expRaw)
      if (!Number.isFinite(parsed)) {
        return undefined
      }
      expiresAt = parsed
    }
    return {
      clientId:
        typeof introspection['client_id'] === 'string'
          ? introspection['client_id']
          : 'unknown',
      extra: introspection,
      scopes: splitScopes(introspection['scope']),
      token,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      // Bound only when the token actually named an audience that matched.
      // Synthesizing one for an audience-less token would claim a binding the
      // authorization server never asserted.
      ...(audiences.length === 0 ? {} : { resource: resourceIdentifier }),
    }
  }

  /**
   * Run the bearer-token validation pipeline for an incoming MCP request:
   * presence → format → introspection → audience → expiry → scope. Each failure
   * emits the matching RFC 6750 / RFC 7662 error.
   *
   * The resource-metadata URL and the audience-checked resource identifier both
   * derive from `baseUrl`, the same base URL `buildProtectedResourceMetadata`
   * publishes from, so the audience this request is checked against is exactly
   * the `resource` clients discover.
   */
  async authenticateRequest(
    req: AuthenticatedRequest,
    res: ServerResponse,
    baseUrl: URL,
  ): Promise<{ authInfo: AuthInfo; ok: true } | { ok: false }> {
    const resourceMetadataUrl = getProtectedResourceMetadataUrl(baseUrl)
    const resourceIdentifier = getOAuthResourceIdentifier(baseUrl)
    const scope = buildOAuthScopeParameter(this.requiredScopes)
    const authHeader = getRequestHeaderValue(req.headers.authorization).trim()
    if (!authHeader) {
      writeOAuthError(
        res,
        401,
        'invalid_request',
        'Missing Authorization header',
        resourceMetadataUrl,
        scope,
      )
      return { ok: false }
    }
    // `authHeader` is non-empty, guarded above, so split always
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
        scope,
      )
      return { ok: false }
    }
    let authInfo: AuthInfo | undefined
    try {
      authInfo = await this.verifyAccessToken(token, resourceIdentifier)
    } catch (e) {
      const message = errorMessage(e)
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
        scope,
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
        scope,
      )
      return { ok: false }
    }
    const missing = this.requiredScopes.filter(
      s => !authInfo.scopes.includes(s),
    )
    if (missing.length > 0) {
      writeOAuthError(
        res,
        403,
        'insufficient_scope',
        `Missing required scopes: ${missing.join(', ')}`,
        resourceMetadataUrl,
        scope,
      )
      return { ok: false }
    }
    req.auth = authInfo
    return { authInfo, ok: true }
  }

  // A rejected token is an operational signal, not a server fault. Loggers that
  // only carry `error` still get the message rather than dropping it.
  private warn(message: string): void {
    if (this.log.warn) {
      this.log.warn(message)
      return
    }
    this.log.error(message)
  }
}
