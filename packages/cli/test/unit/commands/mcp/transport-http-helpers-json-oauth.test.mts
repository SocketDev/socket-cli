/**
 * Unit tests for the MCP HTTP transport's JSON/OAuth-metadata helpers.
 *
 * Test Coverage (100% target): - parseJsonObject: valid object / array / null /
 * primitive / malformed - getProtectedResourceMetadataUrl: appends well-known
 * path - buildProtectedResourceMetadata: includes all required fields -
 * writeJson: status code, headers, body - writeOAuthError: with and without
 * resourceMetadataUrl.
 *
 * Related Files: - src/commands/mcp/transport-http-helpers.mts - Implementation
 * - src/commands/mcp/transport-http.mts - Caller (HTTP server)
 */

import { describe, expect, it, vi } from 'vitest'

import type { ServerResponse } from 'node:http'

import {
  buildProtectedResourceMetadata,
  getProtectedResourceMetadataUrl,
  parseJsonObject,
  writeJson,
  writeOAuthError,
} from '../../../../src/commands/mcp/transport-http-helpers.mts'

import type { OAuthMetadata } from '../../../../src/commands/mcp/transport-http-helpers.mts'

describe('parseJsonObject', () => {
  it('returns the parsed object on valid JSON', () => {
    expect(parseJsonObject('{"a":1}', 'ctx')).toEqual({ a: 1 })
  })

  it('throws with context on malformed JSON', () => {
    expect(() => parseJsonObject('{not valid', 'ctx')).toThrow(
      /ctx returned invalid JSON/,
    )
  })

  it('throws when payload is a JSON array', () => {
    expect(() => parseJsonObject('[1,2,3]', 'ctx')).toThrow(
      /expected a JSON object/,
    )
  })

  it('throws when payload is null', () => {
    expect(() => parseJsonObject('null', 'ctx')).toThrow(
      /expected a JSON object/,
    )
  })

  it('throws when payload is a primitive number', () => {
    expect(() => parseJsonObject('42', 'ctx')).toThrow(/expected a JSON object/)
  })

  it('throws when payload is a primitive string', () => {
    expect(() => parseJsonObject('"hello"', 'ctx')).toThrow(
      /expected a JSON object/,
    )
  })

  it('preserves the underlying error message in the wrapped error', () => {
    expect(() => parseJsonObject('not json at all', 'metadata fetch')).toThrow(
      /metadata fetch returned invalid JSON: /,
    )
  })

  it('throws with String(error) when caught value is not an Error', () => {
    // The catch coerces non-Error throws via String(); JSON.parse only
    // ever throws SyntaxError, but we test the branch with a stub.
    const origParse = JSON.parse
    JSON.parse = (() => {
      throw 'plain string'
    }) as typeof JSON.parse
    try {
      expect(() => parseJsonObject('{}', 'ctx')).toThrow(
        /ctx returned invalid JSON: plain string/,
      )
    } finally {
      JSON.parse = origParse
    }
  })
})

describe('getProtectedResourceMetadataUrl', () => {
  it('appends the well-known path to the base URL', () => {
    const url = new URL('https://example.com/')
    expect(getProtectedResourceMetadataUrl(url)).toBe(
      'https://example.com/.well-known/oauth-protected-resource',
    )
  })

  it('overrides any existing path on the base URL', () => {
    const url = new URL('https://example.com/some/other/path')
    expect(getProtectedResourceMetadataUrl(url)).toBe(
      'https://example.com/.well-known/oauth-protected-resource',
    )
  })
})

describe('buildProtectedResourceMetadata', () => {
  it('packages issuer + resource + scopes + name', () => {
    const baseUrl = new URL('https://api.example.com/')
    const metadata = {
      authorization_endpoint: 'https://auth.example.com/authorize',
      introspection_endpoint: 'https://auth.example.com/introspect',
      issuer: 'https://auth.example.com',
      token_endpoint: 'https://auth.example.com/token',
    } satisfies OAuthMetadata
    const result = buildProtectedResourceMetadata(baseUrl, metadata, [
      'a:read',
      'b:write',
    ])
    expect(result).toEqual({
      authorization_servers: ['https://auth.example.com'],
      resource: 'https://api.example.com/',
      resource_name: 'Socket MCP Server',
      scopes_supported: ['a:read', 'b:write'],
    })
  })
})

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

describe('writeJson', () => {
  it('writes status, default Content-Type, and JSON-stringified body', () => {
    const { res, writeHead, end } = makeRes()
    writeJson(res, 200, { ok: true })
    expect(writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'application/json',
    })
    expect(end).toHaveBeenCalledWith(JSON.stringify({ ok: true }))
  })

  it('merges extra headers', () => {
    const { res, writeHead } = makeRes()
    writeJson(res, 401, { error: 'x' }, { 'WWW-Authenticate': 'Bearer' })
    expect(writeHead).toHaveBeenCalledWith(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer',
    })
  })
})

describe('writeOAuthError', () => {
  it('writes status with WWW-Authenticate (no resource metadata)', () => {
    const { res, writeHead, end } = makeRes()
    writeOAuthError(res, 401, 'invalid_token', 'expired')
    const headers = writeHead.mock.calls[0][1] as Record<string, string>
    expect(headers['WWW-Authenticate']).toBe(
      'Bearer error="invalid_token", error_description="expired"',
    )
    expect(end).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'invalid_token',
        error_description: 'expired',
      }),
    )
  })

  it('appends resource_metadata when provided', () => {
    const { res, writeHead } = makeRes()
    writeOAuthError(
      res,
      401,
      'invalid_token',
      'expired',
      'https://api.example.com/.well-known/oauth-protected-resource',
    )
    const headers = writeHead.mock.calls[0][1] as Record<string, string>
    expect(headers['WWW-Authenticate']).toBe(
      'Bearer error="invalid_token", error_description="expired", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
    )
  })

  it('passes through the supplied status code', () => {
    const { res, writeHead } = makeRes()
    writeOAuthError(res, 403, 'insufficient_scope', 'no scope')
    expect(writeHead).toHaveBeenCalledWith(403, expect.any(Object))
  })
})
