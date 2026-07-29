/**
 * Unit tests for the OAuthIntrospector class.
 *
 * Mocks @socketsecurity/lib/http-request so the issuer's well-known +
 * introspection endpoints can be controlled per-test, exercising every branch
 * of loadMetadata and verifyAccessToken without booting a real HTTP server.
 *
 * Test Coverage (100% target):
 *
 * - LoadMetadata: success / non-2xx / missing required field / memoization /
 *   retry-after-failure clears the cached promise
 * - VerifyAccessToken: 200 active / 200 inactive / non-2xx / missing exp /
 *   non-numeric exp / non-string client_id
 *
 * Related Files:
 *
 * - Src/commands/mcp/oauth-introspector.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthIntrospector } from '../../../../src/commands/mcp/oauth-introspector.mts'

import type { OAuthIntrospectorOptions } from '../../../../src/commands/mcp/oauth-introspector.mts'

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

const log = { error: vi.fn(), warn: vi.fn() }

// The resource identifier every verifyAccessToken call in this file is checked
// against. Matches what getOAuthResourceIdentifier derives from a request whose
// Host is api.example.com.
const RESOURCE = new URL('https://api.example.com/')

beforeEach(() => {
  vi.clearAllMocks()
})

function newIntrospector(
  scopes: readonly string[] = SCOPES,
  options?: OAuthIntrospectorOptions | undefined,
) {
  return new OAuthIntrospector(
    ISSUER,
    CLIENT_ID,
    CLIENT_SECRET,
    scopes,
    log,
    options,
  )
}

describe('OAuthIntrospector — loadMetadata', () => {
  it('fetches and returns valid metadata on success', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: validMetadata }),
    )
    const intro = newIntrospector()
    const m = await intro.loadMetadata()
    expect(m).toMatchObject(validMetadata)
    expect(mockHttpRequest).toHaveBeenCalledWith(
      'https://auth.example.com/.well-known/oauth-authorization-server',
      { method: 'GET' },
    )
  })

  it('memoizes the metadata promise (one fetch across many calls)', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 200, body: validMetadata }),
    )
    const intro = newIntrospector()
    await intro.loadMetadata()
    await intro.loadMetadata()
    await intro.loadMetadata()
    expect(mockHttpRequest).toHaveBeenCalledTimes(1)
  })

  it('throws on non-2xx status with the body in the message', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 500, text: 'boom' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(/HTTP 500: boom/)
  })

  it('throws on 4xx status with the body in the message', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 404, text: 'not found' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(/HTTP 404: not found/)
  })

  it('names every probed well-known URL when discovery finds nothing', async () => {
    mockHttpRequest.mockResolvedValue(fakeResponse({ status: 404, text: '' }))
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /Tried 2 well-known URLs/,
    )
  })

  it('throws when authorization_endpoint is missing', async () => {
    const partial = { ...validMetadata } as Record<string, unknown>
    delete partial['authorization_endpoint']
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 200, body: partial }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /missing required field: authorization_endpoint/,
    )
  })

  it('throws when introspection_endpoint is empty string', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({
        status: 200,
        body: { ...validMetadata, introspection_endpoint: '' },
      }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /missing required field: introspection_endpoint/,
    )
  })

  it('throws when token_endpoint is wrong type', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({
        status: 200,
        body: { ...validMetadata, token_endpoint: 42 },
      }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /missing required field: token_endpoint/,
    )
  })

  it('refuses a metadata document whose issuer names another tenant', async () => {
    // RFC 8414 §3.3. Without this comparison a host that answers the well-known
    // path for one tenant hands this server another tenant's endpoints.
    mockHttpRequest.mockResolvedValue(
      fakeResponse({
        status: 200,
        body: { ...validMetadata, issuer: 'https://evil.example.com' },
      }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /issuer mismatch: document declares "https:\/\/evil\.example\.com", the configured issuer is "https:\/\/auth\.example\.com"/,
    )
  })

  it('clears the cached promise after a failure so the next call retries', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 500, text: 'transient' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow()
    const callsAfterFailure = mockHttpRequest.mock.calls.length
    // Second attempt should re-issue the GET, not return the cached failure.
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 200, body: validMetadata }),
    )
    const m = await intro.loadMetadata()
    expect(m).toMatchObject(validMetadata)
    expect(mockHttpRequest.mock.calls.length).toBeGreaterThan(callsAfterFailure)
  })

  it('throws when the response body is not valid JSON', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 200, text: 'not-json{' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /OAuth metadata discovery returned invalid JSON/,
    )
  })
})

describe('OAuthIntrospector — verifyAccessToken', () => {
  function setupMetadata(metadata: Record<string, unknown> = validMetadata) {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: metadata }),
    )
  }

  it('returns the AuthInfo for an active token with all fields', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: {
          active: true,
          client_id: 'user-app',
          exp: 9_999_999_999,
          scope: 'packages:list extra:read',
        },
      }),
    )
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info).toMatchObject({
      clientId: 'user-app',
      scopes: ['packages:list', 'extra:read'],
      token: 'the-token',
      expiresAt: 9_999_999_999,
    })
  })

  it('returns null when introspection says inactive', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: { active: false } }),
    )
    const intro = newIntrospector()
    expect(await intro.verifyAccessToken('the-token', RESOURCE)).toBe(undefined)
  })

  it('throws on non-2xx introspection status', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 500, text: 'broken' }),
    )
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).rejects.toThrow(/Token introspection failed with status 500: broken/)
  })

  it('returns clientId="unknown" when client_id is missing or not a string', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, client_id: 42, scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.clientId).toBe('unknown')
  })

  it('rejects the token when exp is present but unparseable', async () => {
    // Fail closed. Dropping an unparseable exp would promote the token to
    // never-expiring, so a buggy or compromised introspection endpoint could
    // hand out tokens that never age out.
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, exp: 'not-a-number', scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
  })

  it('rejects the token when exp is an object', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, exp: {}, scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
  })

  it('omits expiresAt when exp is genuinely absent (non-expiring token)', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.expiresAt).toBeUndefined()
    expect(info?.token).toBe('the-token')
  })

  it('refuses an introspection_endpoint pointing at a private host', async () => {
    // The endpoint arrives in the issuer's metadata, so a hostile or MITM'd
    // issuer chooses where the bearer token gets POSTed.
    setupMetadata({
      ...validMetadata,
      introspection_endpoint: 'http://169.254.169.254/introspect',
    })
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).rejects.toThrow(/private\/loopback host/)
  })

  it('parses exp from a string when convertible', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, exp: '9999999999', scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.expiresAt).toBe(9_999_999_999)
  })

  it('returns empty scopes when scope field is missing', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, client_id: 'app' },
      }),
    )
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.scopes).toEqual([])
  })

  it('sends a Basic-auth header derived from clientId:clientSecret', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, client_id: 'app', scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    await intro.verifyAccessToken('the-token', RESOURCE)
    const introCall = mockHttpRequest.mock.calls[1]
    expect(introCall[0]).toBe('https://auth.example.com/introspect')
    const expectedAuth =
      'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    expect(introCall[1].headers.authorization).toBe(expectedAuth)
    expect(introCall[1].headers['content-type']).toBe(
      'application/x-www-form-urlencoded',
    )
    expect(introCall[1].body).toBe('token=the-token')
    expect(introCall[1].method).toBe('POST')
  })
})
