/**
 * Unit tests for RFC 8414 authorization-server metadata discovery.
 *
 * Mocks @socketsecurity/lib-stable/http-request so each well-known candidate
 * can answer independently, proving the probe ORDER and the issuer binding
 * without booting a real issuer.
 *
 * Test Coverage (100% target):
 *
 * - BuildOAuthWellKnownUrls: path-less issuer / path-bearing issuer /
 *   trailing-slash normalization
 * - FetchOAuthMetadataDocument: 2xx / non-2xx / body truncation / bad JSON
 * - DiscoverOAuthMetadata: first candidate wins / falls through to a later
 *   candidate / issuer mismatch is skipped / tenant isolation / aggregate
 *   error
 * - ValidateOAuthMetadataFields: each required field
 *
 * Related Files:
 *
 * - Src/commands/mcp/oauth-discovery.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildOAuthWellKnownUrls,
  discoverOAuthMetadata,
  fetchOAuthMetadataDocument,
  validateOAuthMetadataFields,
} from '../../../../src/commands/mcp/oauth-discovery.mts'

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

function metadataFor(issuer: string): Record<string, unknown> {
  return {
    authorization_endpoint: `${issuer}/authorize`,
    introspection_endpoint: `${issuer}/introspect`,
    issuer,
    token_endpoint: `${issuer}/token`,
  }
}

/**
 * Answer each candidate URL from a routing table. An unlisted URL 404s, which
 * is what a real host does for a tenant that is not there.
 */
function routeByUrl(routes: Record<string, Record<string, unknown>>): void {
  mockHttpRequest.mockImplementation(async (url: string) => {
    const body = routes[url]
    return body
      ? fakeResponse({ status: 200, body })
      : fakeResponse({ status: 404, text: 'not found' })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHttpRequest.mockReset()
})

describe('buildOAuthWellKnownUrls', () => {
  it('probes both root forms for a path-less issuer', () => {
    expect(
      buildOAuthWellKnownUrls(new URL('https://auth.example.com')),
    ).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ])
  })

  it('inserts the well-known segment before a path-bearing issuer path', () => {
    // RFC 8414 §3.1: the segment goes BEFORE the issuer path, so the tenant
    // survives. Appending it would resolve a sibling tenant's document.
    expect(
      buildOAuthWellKnownUrls(new URL('https://auth.example.com/tenant1')),
    ).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://auth.example.com/.well-known/openid-configuration/tenant1',
      'https://auth.example.com/tenant1/.well-known/openid-configuration',
    ])
  })

  it('treats a trailing slash as no path component', () => {
    expect(
      buildOAuthWellKnownUrls(new URL('https://auth.example.com/tenant1/')),
    ).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://auth.example.com/.well-known/openid-configuration/tenant1',
      'https://auth.example.com/tenant1/.well-known/openid-configuration',
    ])
  })

  it('treats a bare root path as path-less', () => {
    expect(
      buildOAuthWellKnownUrls(new URL('https://auth.example.com/')),
    ).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ])
  })
})

describe('fetchOAuthMetadataDocument', () => {
  it('returns the parsed document on 2xx', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({
        status: 200,
        body: metadataFor('https://auth.example.com'),
      }),
    )
    const doc = await fetchOAuthMetadataDocument('https://auth.example.com/x')
    expect(doc.issuer).toBe('https://auth.example.com')
  })

  it('throws with the status and body on a non-2xx', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 503, text: 'unavailable' }),
    )
    await expect(
      fetchOAuthMetadataDocument('https://auth.example.com/x'),
    ).rejects.toThrow(/HTTP 503: unavailable/)
  })

  it('truncates a long error body so it cannot bury other probe results', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 500, text: 'x'.repeat(5000) }),
    )
    await expect(
      fetchOAuthMetadataDocument('https://auth.example.com/x'),
    ).rejects.toThrow(/HTTP 500: x{200}$/)
  })

  it('throws when the body is not a JSON object', async () => {
    mockHttpRequest.mockResolvedValue(
      fakeResponse({ status: 200, text: '[1,2]' }),
    )
    await expect(
      fetchOAuthMetadataDocument('https://auth.example.com/x'),
    ).rejects.toThrow(/expected a JSON object/)
  })
})

describe('discoverOAuthMetadata', () => {
  it('takes the first candidate that matches the configured issuer', async () => {
    const issuer = 'https://auth.example.com'
    routeByUrl({
      [`${issuer}/.well-known/oauth-authorization-server`]: metadataFor(issuer),
    })
    const doc = await discoverOAuthMetadata(new URL(issuer), issuer)
    expect(doc.introspection_endpoint).toBe(`${issuer}/introspect`)
    expect(mockHttpRequest).toHaveBeenCalledTimes(1)
  })

  it('falls through to the openid-configuration form', async () => {
    const issuer = 'https://auth.example.com'
    routeByUrl({
      [`${issuer}/.well-known/openid-configuration`]: metadataFor(issuer),
    })
    const doc = await discoverOAuthMetadata(new URL(issuer), issuer)
    expect(doc.issuer).toBe(issuer)
    expect(mockHttpRequest).toHaveBeenCalledTimes(2)
  })

  it('resolves a path-bearing issuer to its OWN tenant metadata', async () => {
    // The sibling tenant answers the path-APPENDED form. Probing the
    // path-inserted form first is what keeps tenant1 off tenant2's endpoints.
    const issuer = 'https://auth.example.com/tenant1'
    routeByUrl({
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1':
        metadataFor(issuer),
      'https://auth.example.com/.well-known/oauth-authorization-server':
        metadataFor('https://auth.example.com/tenant2'),
    })
    const doc = await discoverOAuthMetadata(new URL(issuer), issuer)
    expect(doc.issuer).toBe('https://auth.example.com/tenant1')
    expect(doc.introspection_endpoint).toBe(
      'https://auth.example.com/tenant1/introspect',
    )
  })

  it('skips a document whose issuer names a different tenant', async () => {
    const issuer = 'https://auth.example.com/tenant1'
    routeByUrl({
      // The path-inserted probe answers with tenant2's document — a
      // misconfigured or hostile host. It must be refused, and the
      // path-appended fallback must supply the real one.
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant1':
        metadataFor('https://auth.example.com/tenant2'),
      'https://auth.example.com/tenant1/.well-known/openid-configuration':
        metadataFor(issuer),
    })
    const doc = await discoverOAuthMetadata(new URL(issuer), issuer)
    expect(doc.issuer).toBe(issuer)
  })

  it('refuses discovery when every document declares another issuer', async () => {
    const issuer = 'https://auth.example.com'
    routeByUrl({
      [`${issuer}/.well-known/oauth-authorization-server`]: metadataFor(
        'https://evil.example.com',
      ),
      [`${issuer}/.well-known/openid-configuration`]: metadataFor(
        'https://evil.example.com',
      ),
    })
    await expect(
      discoverOAuthMetadata(new URL(issuer), issuer),
    ).rejects.toThrow(
      /issuer mismatch: document declares "https:\/\/evil\.example\.com"/,
    )
  })

  it('compares the issuer byte for byte, without trailing-slash normalization', async () => {
    // RFC 8414 §3.3 mandates RFC 3986 simple string comparison. A document
    // declaring the slash-suffixed form is a different identifier.
    const issuer = 'https://auth.example.com'
    routeByUrl({
      [`${issuer}/.well-known/oauth-authorization-server`]: metadataFor(
        'https://auth.example.com/',
      ),
      [`${issuer}/.well-known/openid-configuration`]: metadataFor(
        'https://auth.example.com/',
      ),
    })
    await expect(
      discoverOAuthMetadata(new URL(issuer), issuer),
    ).rejects.toThrow(/issuer mismatch/)
  })

  it('names every probed URL and the fix in the aggregate error', async () => {
    const issuer = 'https://auth.example.com'
    routeByUrl({})
    await expect(
      discoverOAuthMetadata(new URL(issuer), issuer),
    ).rejects.toThrow(
      /found no usable metadata for issuer "https:\/\/auth\.example\.com"\. Tried 2 well-known URLs:/,
    )
  })
})

describe('validateOAuthMetadataFields', () => {
  it('accepts a complete document', () => {
    expect(() =>
      validateOAuthMetadataFields(metadataFor('https://auth.example.com')),
    ).not.toThrow()
  })

  it.each([
    'authorization_endpoint',
    'introspection_endpoint',
    'issuer',
    'token_endpoint',
  ])('rejects a document missing %s', field => {
    const doc = metadataFor('https://auth.example.com')
    delete doc[field]
    expect(() => validateOAuthMetadataFields(doc)).toThrow(
      new RegExp(`missing required field: ${field}`),
    )
  })

  it('explains why introspection_endpoint is required here', () => {
    const doc = metadataFor('https://auth.example.com')
    delete doc['introspection_endpoint']
    expect(() => validateOAuthMetadataFields(doc)).toThrow(
      /RFC 7662 introspection is its only token-verification strategy/,
    )
  })
})
