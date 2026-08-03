/**
 * Unit tests for RFC 8707 audience validation in OAuthIntrospector.
 *
 * Mocks @socketsecurity/lib-stable/http-request so the issuer's well-known +
 * introspection endpoints answer per-test, driving every audience branch of
 * verifyAccessToken without booting a real HTTP server.
 *
 * Test Coverage (100% target):
 *
 * - A token whose aud names another resource is rejected, flag or no flag
 * - A token whose aud names this resource is accepted and bound to it
 * - A token with no aud is accepted by default and rejected under requireAudience
 * - An unparseable aud fails closed
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

describe('OAuthIntrospector — RFC 8707 audience validation', () => {
  function setupIntrospection(introspection: Record<string, unknown>) {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: validMetadata }),
    )
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: introspection }),
    )
  }

  const activeToken = {
    active: true,
    client_id: 'app',
    scope: 'packages:list',
  }

  it('rejects a token whose aud names another resource server', async () => {
    // The confused-deputy case: the same authorization server introspects the
    // token as active, but it was minted for a different resource.
    setupIntrospection({ ...activeToken, aud: 'https://other.example.com/' })
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rejected a token minted for another resource'),
    )
  })

  it('rejects a token whose aud array holds only foreign resources', async () => {
    setupIntrospection({
      ...activeToken,
      aud: ['https://other.example.com/', 'https://third.example.com/'],
    })
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
  })

  it('rejects a token whose aud is not a URL at all', async () => {
    // An unparseable audience can never name a URL resource identifier, so it
    // fails closed rather than throwing out of the pipeline.
    setupIntrospection({ ...activeToken, aud: 'not-a-url' })
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
  })

  it('accepts a token whose aud names this resource and binds it', async () => {
    setupIntrospection({ ...activeToken, aud: 'https://api.example.com/' })
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.token).toBe('the-token')
    expect(info?.resource?.href).toBe('https://api.example.com/')
  })

  it('accepts a token whose aud array contains this resource', async () => {
    setupIntrospection({
      ...activeToken,
      aud: ['https://other.example.com/', 'https://api.example.com/'],
    })
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.token).toBe('the-token')
  })

  it('accepts a token with no aud claim by default', async () => {
    // Socket's introspection endpoint does not emit `aud` yet; making absence
    // fatal by default would break every current deployment.
    setupIntrospection({ ...activeToken })
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.token).toBe('the-token')
  })

  it('leaves resource unbound when the token named no audience', async () => {
    // Synthesizing a binding the authorization server never asserted would
    // claim more than introspection proved.
    setupIntrospection({ ...activeToken })
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.resource).toBeUndefined()
  })

  it('accepts a token with an empty-string aud by default', async () => {
    setupIntrospection({ ...activeToken, aud: '   ' })
    const intro = newIntrospector()
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.token).toBe('the-token')
  })

  it('rejects a token with no aud claim when requireAudience is set', async () => {
    setupIntrospection({ ...activeToken })
    const intro = newIntrospector(SCOPES, { requireAudience: true })
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('carrying no "aud" claim'),
    )
  })

  it('still accepts a matching aud when requireAudience is set', async () => {
    setupIntrospection({ ...activeToken, aud: 'https://api.example.com/' })
    const intro = newIntrospector(SCOPES, { requireAudience: true })
    const info = await intro.verifyAccessToken('the-token', RESOURCE)
    expect(info?.token).toBe('the-token')
  })

  it('rejects a foreign aud even when requireAudience is off', async () => {
    // The flag governs ABSENCE only. A present-but-wrong audience is the
    // substitution attack and no flag opens it.
    setupIntrospection({ ...activeToken, aud: 'https://other.example.com/' })
    const intro = newIntrospector(SCOPES, { requireAudience: false })
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
  })

  it('checks audience before expiry so a foreign token never reports expired', async () => {
    setupIntrospection({
      ...activeToken,
      aud: 'https://other.example.com/',
      exp: 'not-a-number',
    })
    const intro = newIntrospector()
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rejected a token minted for another resource'),
    )
  })

  it('falls back to log.error when the logger carries no warn', async () => {
    setupIntrospection({ ...activeToken, aud: 'https://other.example.com/' })
    const errorOnlyLog = { error: vi.fn() }
    const intro = new OAuthIntrospector(
      ISSUER,
      CLIENT_ID,
      CLIENT_SECRET,
      SCOPES,
      errorOnlyLog,
    )
    await expect(
      intro.verifyAccessToken('the-token', RESOURCE),
    ).resolves.toBeUndefined()
    expect(errorOnlyLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Rejected a token minted for another resource'),
    )
  })
})
