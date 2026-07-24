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
 * - Src/commands/mcp/transport-http-helpers.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthIntrospector } from '../../../../src/commands/mcp/transport-http-helpers.mts'

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

const log = { error: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
})

function newIntrospector(scopes: readonly string[] = SCOPES) {
  return new OAuthIntrospector(ISSUER, CLIENT_ID, CLIENT_SECRET, scopes, log)
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
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 500, text: 'boom' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /OAuth metadata discovery failed with status 500: boom/,
    )
  })

  it('throws on 4xx status with the body in the message', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 404, text: 'not found' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /OAuth metadata discovery failed with status 404/,
    )
  })

  it('throws when authorization_endpoint is missing', async () => {
    const partial = { ...validMetadata } as Record<string, unknown>
    delete partial['authorization_endpoint']
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: partial }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /missing required field: authorization_endpoint/,
    )
  })

  it('throws when introspection_endpoint is empty string', async () => {
    mockHttpRequest.mockResolvedValueOnce(
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
    mockHttpRequest.mockResolvedValueOnce(
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

  it('clears the cached promise after a failure so the next call retries', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 500, text: 'transient' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow()
    // Second attempt should re-issue the GET, not return the cached
    // failure.
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: validMetadata }),
    )
    const m = await intro.loadMetadata()
    expect(m).toMatchObject(validMetadata)
    expect(mockHttpRequest).toHaveBeenCalledTimes(2)
  })

  it('throws when the response body is not valid JSON', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, text: 'not-json{' }),
    )
    const intro = newIntrospector()
    await expect(intro.loadMetadata()).rejects.toThrow(
      /OAuth metadata discovery returned invalid JSON/,
    )
  })
})

describe('OAuthIntrospector — verifyAccessToken', () => {
  function setupMetadata() {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: validMetadata }),
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
    const info = await intro.verifyAccessToken('the-token')
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
    expect(await intro.verifyAccessToken('the-token')).toBe(undefined)
  })

  it('throws on non-2xx introspection status', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 500, text: 'broken' }),
    )
    const intro = newIntrospector()
    await expect(intro.verifyAccessToken('the-token')).rejects.toThrow(
      /Token introspection failed with status 500: broken/,
    )
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
    const info = await intro.verifyAccessToken('the-token')
    expect(info?.clientId).toBe('unknown')
  })

  it('omits expiresAt when exp is non-numeric', async () => {
    setupMetadata()
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { active: true, exp: 'not-a-number', scope: 'packages:list' },
      }),
    )
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token')
    expect(info?.expiresAt).toBeUndefined()
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
    const info = await intro.verifyAccessToken('the-token')
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
    const info = await intro.verifyAccessToken('the-token')
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
    await intro.verifyAccessToken('the-token')
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
