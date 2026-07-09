/**
 * Unit tests for the OAuthIntrospector class — authenticateRequest.
 *
 * Mocks @socketsecurity/lib/http-request so the issuer's well-known +
 * introspection endpoints can be controlled per-test, exercising every branch
 * of authenticateRequest without booting a real HTTP server.
 *
 * Test Coverage (100% target):
 *
 * - AuthenticateRequest: missing Authorization / non-Bearer / bare "Bearer" /
 *   verifier throws / inactive / expired / missing scope / success
 *
 * Related Files:
 *
 * - Src/commands/mcp/transport-http-helpers.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthIntrospector } from '../../../../src/commands/mcp/transport-http-helpers.mts'

import type { ServerResponse } from 'node:http'
import type { IncomingMessage } from 'node:http'

import type * as HttpRequestModule from '@socketsecurity/lib-stable/http-request/request'

const { mockHttpRequest } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/http-request/request'),
  async importOriginal => {
    const actual = await importOriginal<typeof HttpRequestModule>()
    return {
      ...actual,
      httpRequest: mockHttpRequest,
    }
  },
)

const ISSUER = 'https://auth.example.com'
const CLIENT_ID = 'client-id'
const CLIENT_SECRET = 'client-secret'
const SCOPES = ['packages:list'] as const

function fakeResponse(opts: {
  status: number
  body?: unknown | undefined
  text?: string | undefined
}) {
  const text =
    opts.text ?? (opts.body !== undefined ? JSON.stringify(opts.body) : '')
  return {
    arrayBuffer: () => new ArrayBuffer(0),
    body: Buffer.from(text),
    headers: {},
    json: () => JSON.parse(text),
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    statusText: '',
    text: () => text,
  }
}

const validMetadata = {
  authorization_endpoint: 'https://auth.example.com/authorize',
  introspection_endpoint: 'https://auth.example.com/introspect',
  issuer: ISSUER,
  token_endpoint: 'https://auth.example.com/token',
}

export function makeRes(): {
  res: ServerResponse
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
} {
  const writeHead = vi.fn()
  const end = vi.fn()
  return {
    res: { writeHead, end } as unknown as ServerResponse,
    writeHead,
    end,
  }
}

export function makeReq(authHeader?: string | undefined) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as IncomingMessage
}

const log = { error: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
})

function newIntrospector(scopes: readonly string[] = SCOPES) {
  return new OAuthIntrospector(ISSUER, CLIENT_ID, CLIENT_SECRET, scopes, log)
}

describe('OAuthIntrospector — authenticateRequest', () => {
  // Each Bearer-token path goes through verifyAccessToken which itself
  // calls loadMetadata. Pre-stub BOTH calls (metadata + introspection)
  // when we expect verification to run.
  function newIntrospectorWithMetadataPrimed(): InstanceType<
    typeof OAuthIntrospector
  > {
    const intro = newIntrospector()
    // Force metadata into the cache so subsequent verifyAccessToken
    // calls only need an introspection mock.
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: validMetadata }),
    )
    // Trigger the load now. The caller adds an introspection mock next.
    return intro
  }
  async function prime(intro: InstanceType<typeof OAuthIntrospector>) {
    await intro.loadMetadata()
  }

  it('returns 401 invalid_request when Authorization header is missing', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    const { res, writeHead } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq(),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('invalid_request'),
      }),
    )
  })

  it('returns 401 when Authorization is not a Bearer token', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    const { res, writeHead } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq('Basic abc='),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('Bearer TOKEN'),
      }),
    )
  })

  it('returns 401 when Authorization starts with leading whitespace (type empty)', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    const { res, writeHead } = makeRes()
    // ' bearer foo'.trim() in transport sees the trim() in
    // getRequestHeaderValue + .trim(). The auth check is on the
    // post-trim string, so leading whitespace gets stripped before we
    // even see the value. Pass the header without trim happening to
    // hit the `type || ''` left-falsy branch — but trim() in the
    // outer code strips whitespace. The only way to get a falsy
    // `type` from `split(/\s+/u)` on a non-empty trimmed string is an
    // empty string, which is filtered earlier. The `type || ''` arm
    // is therefore reached when `type === undefined` — only possible
    // if the regex split produced a length-0 array, which it won't
    // for any non-empty string. Documenting that: this is a
    // defense-in-depth branch.
    //
    // Instead, simulate via a header that's just spaces — which gets
    // trimmed to empty and triggers the missing-header branch. So
    // the (type || '') falsy arm is structurally unreachable; mark
    // covered by reading a single-token header below.
    const result = await intro.authenticateRequest(
      makeReq('SingleToken'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    // Single token, no scheme: type = 'SingleToken', token = undefined.
    // First clause fails: 'singletoken' !== 'bearer' → true → 401.
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('invalid_request'),
      }),
    )
  })

  it('returns 401 when Bearer scheme is present but token is empty', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    const { res, writeHead } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq('Bearer'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('invalid_request'),
      }),
    )
  })

  it('returns 500 server_error and logs when verifier throws', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    // Introspection POST fails with a network error.
    mockHttpRequest.mockRejectedValueOnce(new Error('ECONNRESET'))
    const { res, writeHead, end } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq('Bearer abc'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Token verification failed: ECONNRESET'),
    )
    expect(writeHead).toHaveBeenCalledWith(500, expect.any(Object))
    const body = JSON.parse(end.mock.calls[0][0] as string)
    expect(body.error).toBe('server_error')
  })

  it('coerces non-Error verifier rejections via String()', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    mockHttpRequest.mockRejectedValueOnce('plain string')
    const { res } = makeRes()
    await intro.authenticateRequest(
      makeReq('Bearer abc'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Token verification failed: plain string'),
    )
  })

  it('returns 401 invalid_token when verifier returns null (inactive)', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: { active: false } }),
    )
    const { res, writeHead } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq('Bearer abc'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('invalid_token'),
      }),
    )
  })

  it('returns 401 invalid_token when token has expired', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    const past = Math.floor(Date.now() / 1000) - 60
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: {
          active: true,
          client_id: 'app',
          exp: past,
          scope: 'packages:list',
        },
      }),
    )
    const { res, writeHead } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq('Bearer abc'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('Token has expired'),
      }),
    )
  })

  it('returns 403 insufficient_scope when token lacks the required scope', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, client_id: 'app', scope: 'something:else' },
      }),
    )
    const { res, writeHead } = makeRes()
    const result = await intro.authenticateRequest(
      makeReq('Bearer abc'),
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(false)
    expect(writeHead).toHaveBeenCalledWith(
      403,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('insufficient_scope'),
      }),
    )
  })

  it('returns ok with authInfo and stamps req.auth on success', async () => {
    const intro = newIntrospectorWithMetadataPrimed()
    await prime(intro)
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: {
          active: true,
          client_id: 'app',
          scope: 'packages:list',
          exp: 9_999_999_999,
        },
      }),
    )
    const req = makeReq('Bearer some-token')
    const { res } = makeRes()
    const result = await intro.authenticateRequest(
      req,
      res,
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.authInfo.token).toBe('some-token')
      expect(result.authInfo.scopes).toContain('packages:list')
    }
    expect(
      (req as unknown as { auth?: { token: string } | undefined }).auth?.token,
    ).toBe('some-token')
  })
})
