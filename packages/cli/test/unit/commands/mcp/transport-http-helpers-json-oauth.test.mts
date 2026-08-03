/**
 * Unit tests for the MCP HTTP transport's JSON/OAuth-metadata helpers.
 *
 * Test Coverage (100% target): - parseJsonObject: valid object / array / null /
 * primitive / malformed - getProtectedResourceMetadataUrl: appends well-known
 * path - getOAuthResourceIdentifier: strips fragment / path -
 * buildProtectedResourceMetadata: includes all required fields -
 * buildOAuthScopeParameter: joins, drops non-resource scopes - writeJson:
 * status code, headers, body - writeOAuthError: with and without
 * resourceMetadataUrl / scope - handleRequestSafely: success / thrown error /
 * already-streaming / non-Error throw - module-level constants.
 *
 * Related Files: - src/commands/mcp/transport-http-helpers.mts - Implementation
 * - src/commands/mcp/transport-http.mts - Caller (HTTP server)
 */

import { describe, expect, it, vi } from 'vitest'

import type { ServerResponse } from 'node:http'

import {
  buildOAuthResourceScopes,
  buildOAuthScopeParameter,
  buildProtectedResourceMetadata,
  getOAuthResourceIdentifier,
  getProtectedResourceMetadataUrl,
  handleRequestSafely,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  parseJsonObject,
  writeJson,
  writeOAuthError,
} from '../../../../src/commands/mcp/transport-http-helpers.mts'

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

describe('getOAuthResourceIdentifier', () => {
  it('reduces any request base URL to the server root', () => {
    expect(
      getOAuthResourceIdentifier(new URL('https://api.example.com/mcp')).href,
    ).toBe('https://api.example.com/')
  })

  it('drops an RFC 8707-forbidden fragment', () => {
    expect(
      getOAuthResourceIdentifier(new URL('https://api.example.com/#frag')).href,
    ).toBe('https://api.example.com/')
  })

  it('keeps the port, which is part of the resource identity', () => {
    expect(
      getOAuthResourceIdentifier(new URL('http://127.0.0.1:8080/')).href,
    ).toBe('http://127.0.0.1:8080/')
  })
})

describe('buildOAuthScopeParameter', () => {
  it('joins the required scopes with a single space', () => {
    expect(buildOAuthScopeParameter(['a:read', 'b:write'])).toBe(
      'a:read b:write',
    )
  })

  it('is empty when no scope is enforced', () => {
    expect(buildOAuthScopeParameter([])).toBe('')
  })

  it('drops offline_access, which has no meaning on a resource server', () => {
    expect(buildOAuthResourceScopes(['offline_access', 'a:read'])).toEqual([
      'a:read',
    ])
    expect(buildOAuthScopeParameter(['offline_access'])).toBe('')
  })
})

describe('buildProtectedResourceMetadata', () => {
  it('packages issuer + resource + scopes + name', () => {
    const baseUrl = new URL('https://api.example.com/')
    const result = buildProtectedResourceMetadata(
      baseUrl,
      'https://auth.example.com',
      ['a:read', 'b:write'],
    )
    expect(result).toEqual({
      authorization_servers: ['https://auth.example.com'],
      bearer_methods_supported: ['header'],
      resource: 'https://api.example.com/',
      resource_name: 'Socket MCP Server',
      scopes_supported: ['a:read', 'b:write'],
    })
  })

  it('publishes the server root even when the request carried a path', () => {
    // The published `resource` and the audience-checked identifier must not
    // drift: a client requesting a token for the advertised value has to end up
    // with a token this server accepts. Both come from
    // getOAuthResourceIdentifier, which reduces any request URL to the root.
    const result = buildProtectedResourceMetadata(
      new URL('https://api.example.com/mcp'),
      'https://auth.example.com',
      [],
    )
    expect(result['resource']).toBe('https://api.example.com/')
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

  it('appends the scope parameter so a client can request what is missing', () => {
    const { res, writeHead } = makeRes()
    writeOAuthError(
      res,
      403,
      'insufficient_scope',
      'no scope',
      'https://api.example.com/.well-known/oauth-protected-resource',
      'packages:list',
    )
    const headers = writeHead.mock.calls[0][1] as Record<string, string>
    expect(headers['WWW-Authenticate']).toBe(
      'Bearer error="insufficient_scope", error_description="no scope", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", scope="packages:list"',
    )
  })

  it('omits the scope parameter when no scope is enforced', () => {
    const { res, writeHead } = makeRes()
    writeOAuthError(res, 401, 'invalid_token', 'expired', undefined, '')
    const headers = writeHead.mock.calls[0][1] as Record<string, string>
    expect(headers['WWW-Authenticate']).toBe(
      'Bearer error="invalid_token", error_description="expired"',
    )
  })
})

describe('handleRequestSafely', () => {
  it('runs the handler and returns silently when no error is thrown', async () => {
    const { end, res, writeHead } = makeRes()
    const log = { error: vi.fn() }
    const fn = vi.fn(async () => {
      // Pretend the handler wrote its own response.
    })
    await handleRequestSafely('POST', res, log, fn)
    expect(fn).toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
    expect(writeHead).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })

  it('logs and writes a 500 JSON-RPC envelope when the handler throws', async () => {
    const { end, res, writeHead } = makeRes()
    Object.defineProperty(res, 'headersSent', { value: false, writable: true })
    const log = { error: vi.fn() }
    await handleRequestSafely('GET', res, log, async () => {
      throw new Error('transport boom')
    })
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error processing GET request:'),
    )
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('transport boom'),
    )
    expect(writeHead).toHaveBeenCalledWith(500, expect.any(Object))
    const body = JSON.parse(end.mock.calls[0]![0] as string)
    expect(body.error.code).toBe(-32_603)
    expect(body.error.message).toBe('Internal server error')
    expect(body.id).toBe(undefined)
    expect(body.jsonrpc).toBe('2.0')
  })

  it('does not call writeHead when response is already streaming (headersSent=true)', async () => {
    const { res, writeHead } = makeRes()
    Object.defineProperty(res, 'headersSent', { value: true, writable: false })
    const log = { error: vi.fn() }
    await handleRequestSafely('DELETE', res, log, async () => {
      throw new Error('mid-stream failure')
    })
    expect(log.error).toHaveBeenCalled()
    // The 500 envelope must NOT be written when the SDK has already
    // started the response, otherwise the worker crashes.
    expect(writeHead).not.toHaveBeenCalled()
  })

  it('coerces non-Error throws via the template literal', async () => {
    const { res } = makeRes()
    Object.defineProperty(res, 'headersSent', { value: false, writable: true })
    const log = { error: vi.fn() }
    await handleRequestSafely('POST', res, log, async () => {
      throw 'plain string error'
    })
    expect(log.error).toHaveBeenCalledWith(
      'Error processing POST request: plain string error',
    )
  })
})

describe('module-level constants', () => {
  it('exposes the protected-resource metadata path', () => {
    expect(OAUTH_PROTECTED_RESOURCE_METADATA_PATH).toBe(
      '/.well-known/oauth-protected-resource',
    )
  })
})
