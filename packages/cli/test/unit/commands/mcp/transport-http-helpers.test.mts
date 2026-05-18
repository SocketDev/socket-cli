/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
/**
 * Unit tests for the MCP HTTP transport's pure helpers.
 *
 * These small functions handle header normalization, base-URL construction,
 * JSON parsing, scope splitting, OAuth error formatting, and origin
 * classification. Pulled out of transport-http.mts so they can be exercised
 * directly without booting an HTTP server.
 *
 * Test Coverage (100% target): - getRequestHeaderValue: undefined / string /
 * array / empty array - getForwardedHeaderValue: empty / single / comma-list /
 * whitespace - getRequestBaseUrl: trustProxy on/off × forwarded headers
 * present/missing × tls / non-tls socket × forwarded-proto valid/invalid -
 * parseJsonObject: valid object / array / null / primitive / malformed -
 * getProtectedResourceMetadataUrl: appends well-known path -
 * buildProtectedResourceMetadata: includes all required fields - writeJson:
 * status code, headers, body - writeOAuthError: with and without
 * resourceMetadataUrl - splitScopes: non-string / empty string / single /
 * multiple / extra ws - isLocalhostOrigin: localhost / 127.0.0.1 / other /
 * malformed URL.
 *
 * Related Files: - src/commands/mcp/transport-http-helpers.mts - Implementation
 * - src/commands/mcp/transport-http.mts - Caller (HTTP server)
 */

import { describe, expect, it, vi } from 'vitest'

import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  OAUTH_WELL_KNOWN_PATH,
  buildProtectedResourceMetadata,
  destroySessionEntry,
  getForwardedHeaderValue,
  getProtectedResourceMetadataUrl,
  getRequestBaseUrl,
  getRequestHeaderValue,
  handleRequestSafely,
  isLocalhostOrigin,
  makeOnTransportClose,
  parseJsonObject,
  reapIdleSessions,
  splitScopes,
  writeJson,
  writeOAuthError,
} from '../../../../src/commands/mcp/transport-http-helpers.mts'

import type { SessionLike } from '../../../../src/commands/mcp/transport-http-helpers.mts'

import type { OAuthMetadata } from '../../../../src/commands/mcp/transport-http-helpers.mts'

describe('getRequestHeaderValue', () => {
  it('returns empty string when header is undefined', () => {
    expect(getRequestHeaderValue(undefined)).toBe('')
  })

  it('returns the string when header is a string', () => {
    expect(getRequestHeaderValue('foo')).toBe('foo')
  })

  it('returns the first element when header is an array', () => {
    expect(getRequestHeaderValue(['first', 'second'])).toBe('first')
  })

  it('returns empty string when header is an empty array', () => {
    expect(getRequestHeaderValue([])).toBe('')
  })

  it('returns empty string when array first element is empty', () => {
    expect(getRequestHeaderValue(['', 'second'])).toBe('')
  })

  it('returns empty string when string is empty', () => {
    expect(getRequestHeaderValue('')).toBe('')
  })
})

describe('getForwardedHeaderValue', () => {
  it('returns empty string when header is undefined', () => {
    expect(getForwardedHeaderValue(undefined)).toBe('')
  })

  it('returns a single value untrimmed of internal spaces', () => {
    expect(getForwardedHeaderValue('https')).toBe('https')
  })

  it('returns the first comma-separated value', () => {
    expect(getForwardedHeaderValue('https, http, https')).toBe('https')
  })

  it('trims whitespace around the first value', () => {
    expect(getForwardedHeaderValue('   https   , http')).toBe('https')
  })

  it('returns empty string for an empty string', () => {
    expect(getForwardedHeaderValue('')).toBe('')
  })

  it('returns empty string when comma-list starts with comma', () => {
    expect(getForwardedHeaderValue(',https')).toBe('')
  })

  it('handles array form by reading the first element', () => {
    expect(getForwardedHeaderValue(['https, http', 'second'])).toBe('https')
  })
})

export function makeReq(opts: {
  headers?: Record<string, string | string[] | undefined> | undefined
  encrypted?: boolean | undefined
}): IncomingMessage {
  return {
    headers: opts.headers ?? {},
    socket: { encrypted: opts.encrypted ?? false },
  } as unknown as IncomingMessage
}

describe('getRequestBaseUrl', () => {
  it('uses Host header when trustProxy=false (default)', () => {
    const url = getRequestBaseUrl(
      makeReq({ headers: { host: 'example.com' } }),
      3000,
      false,
    )
    expect(url.hostname).toBe('example.com')
    expect(url.protocol).toBe('http:')
  })

  it('falls back to localhost:port when Host header is missing', () => {
    const url = getRequestBaseUrl(makeReq({}), 3000, false)
    expect(url.hostname).toBe('localhost')
    expect(url.port).toBe('3000')
  })

  it('uses https when socket is encrypted', () => {
    const url = getRequestBaseUrl(
      makeReq({ headers: { host: 'example.com' }, encrypted: true }),
      3000,
      false,
    )
    expect(url.protocol).toBe('https:')
  })

  it('ignores X-Forwarded-Proto when trustProxy=false', () => {
    const url = getRequestBaseUrl(
      makeReq({
        headers: {
          host: 'example.com',
          'x-forwarded-proto': 'https',
        },
      }),
      3000,
      false,
    )
    expect(url.protocol).toBe('http:')
  })

  it('honors X-Forwarded-Proto when trustProxy=true', () => {
    const url = getRequestBaseUrl(
      makeReq({
        headers: {
          host: 'example.com',
          'x-forwarded-proto': 'https',
        },
      }),
      3000,
      true,
    )
    expect(url.protocol).toBe('https:')
  })

  it('honors X-Forwarded-Host when trustProxy=true', () => {
    const url = getRequestBaseUrl(
      makeReq({
        headers: {
          host: 'internal.local',
          'x-forwarded-host': 'public.example.com',
        },
      }),
      3000,
      true,
    )
    expect(url.hostname).toBe('public.example.com')
  })

  it('case-folds X-Forwarded-Proto and accepts http only', () => {
    const url = getRequestBaseUrl(
      makeReq({
        headers: {
          host: 'example.com',
          'x-forwarded-proto': 'HTTP',
        },
      }),
      3000,
      true,
    )
    expect(url.protocol).toBe('http:')
  })

  it('falls back to socket-detected protocol when X-Forwarded-Proto is unrecognized', () => {
    const url = getRequestBaseUrl(
      makeReq({
        headers: {
          host: 'example.com',
          'x-forwarded-proto': 'gopher',
        },
        encrypted: true,
      }),
      3000,
      true,
    )
    // Unrecognized forwarded value → fall through to socket.encrypted.
    expect(url.protocol).toBe('https:')
  })
})

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
      // eslint-disable-next-line no-throw-literal -- Deliberately throwing a non-Error to exercise the String(e) branch.
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
      `https://example.com${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}`,
    )
  })

  it('overrides any existing path on the base URL', () => {
    const url = new URL('https://example.com/some/other/path')
    expect(getProtectedResourceMetadataUrl(url)).toBe(
      `https://example.com${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}`,
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

describe('splitScopes', () => {
  it('returns empty array for non-string input (number)', () => {
    expect(splitScopes(42)).toEqual([])
  })

  it('returns empty array for non-string input (object)', () => {
    expect(splitScopes({ scope: 'a' })).toEqual([])
  })

  it('returns empty array for non-string input (null)', () => {
    expect(splitScopes(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(splitScopes('')).toEqual([])
  })

  it('splits a single space-separated list', () => {
    expect(splitScopes('a:read b:write')).toEqual(['a:read', 'b:write'])
  })

  it('splits on tabs and other whitespace', () => {
    expect(splitScopes('a:read\tb:write\nc:exec')).toEqual([
      'a:read',
      'b:write',
      'c:exec',
    ])
  })

  it('drops empty entries from extra whitespace', () => {
    expect(splitScopes('   a:read     b:write   ')).toEqual([
      'a:read',
      'b:write',
    ])
  })

  it('returns the single scope when only one is present', () => {
    expect(splitScopes('a:read')).toEqual(['a:read'])
  })
})

describe('isLocalhostOrigin', () => {
  it('returns true for http://localhost', () => {
    expect(isLocalhostOrigin('http://localhost')).toBe(true)
  })

  it('returns true for http://localhost:3000', () => {
    expect(isLocalhostOrigin('http://localhost:3000')).toBe(true)
  })

  it('returns true for http://127.0.0.1', () => {
    expect(isLocalhostOrigin('http://127.0.0.1')).toBe(true)
  })

  it('returns true for https://127.0.0.1:8443', () => {
    expect(isLocalhostOrigin('https://127.0.0.1:8443')).toBe(true)
  })

  it('returns false for an external origin', () => {
    expect(isLocalhostOrigin('https://attacker.example.com')).toBe(false)
  })

  it('returns false for malicious-localhost.evil.com', () => {
    expect(isLocalhostOrigin('https://malicious-localhost.evil.com')).toBe(
      false,
    )
  })

  it('returns false for a malformed URL', () => {
    expect(isLocalhostOrigin('not a url at all')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isLocalhostOrigin('')).toBe(false)
  })

  it('returns false for IPv6 loopback (does not match localhost/127.0.0.1)', () => {
    // Documenting current behavior: ::1 is NOT recognized; only the
    // two literal forms are. If we want to extend, that's a deliberate
    // change.
    expect(isLocalhostOrigin('http://[::1]')).toBe(false)
  })
})

describe('destroySessionEntry', () => {
  function fakeSession(
    opts: {
      transportClose?: (() => void) | undefined
      serverClose?: (() => Promise<unknown>) | undefined
    } = {},
  ): SessionLike {
    return {
      lastActivity: 0,
      server: {
        close: opts.serverClose ?? (() => Promise.resolve()),
      },
      transport: {
        close: opts.transportClose ?? (() => {}),
      },
    }
  }

  it('returns early when the session id is unknown', () => {
    const sessions = new Map<string, SessionLike>()
    const log = { info: vi.fn() }
    destroySessionEntry('does-not-exist', sessions, log)
    expect(log.info).not.toHaveBeenCalled()
  })

  it('deletes the session, closes the transport and server, and logs', () => {
    const transportClose = vi.fn()
    const serverClose = vi.fn(() => Promise.resolve())
    const session = fakeSession({ transportClose, serverClose })
    const sessions = new Map<string, SessionLike>([['s1', session]])
    const log = { info: vi.fn() }
    destroySessionEntry('s1', sessions, log)
    expect(sessions.has('s1')).toBe(false)
    expect(transportClose).toHaveBeenCalled()
    expect(serverClose).toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith('Session s1 destroyed')
  })

  it('swallows synchronous throws from transport.close()', () => {
    const transportClose = vi.fn(() => {
      throw new Error('mid-stream close')
    })
    const sessions = new Map<string, SessionLike>([
      ['s1', fakeSession({ transportClose })],
    ])
    const log = { info: vi.fn() }
    expect(() => destroySessionEntry('s1', sessions, log)).not.toThrow()
    expect(log.info).toHaveBeenCalledWith('Session s1 destroyed')
  })

  it('swallows async rejections from server.close() (the .catch arm)', async () => {
    const serverClose = vi.fn(() => Promise.reject(new Error('shutdown race')))
    const sessions = new Map<string, SessionLike>([
      ['s1', fakeSession({ serverClose })],
    ])
    const log = { info: vi.fn() }
    destroySessionEntry('s1', sessions, log)
    // Wait a microtask for the rejection to flush through .catch.
    await Promise.resolve()
    await Promise.resolve()
    // Test passes iff destroySessionEntry didn't propagate the
    // unhandled rejection to the test runner.
    expect(serverClose).toHaveBeenCalled()
  })
})

describe('makeOnTransportClose', () => {
  it('calls destroy(id) when the transport reports a sessionId', () => {
    const destroy = vi.fn()
    const onclose = makeOnTransportClose(() => 'session-abc', destroy)
    onclose()
    expect(destroy).toHaveBeenCalledWith('session-abc')
  })

  it('is a no-op when the transport has no sessionId yet', () => {
    // Fires when onclose runs before onsessioninitialized has assigned
    // a sessionId — the SDK can close a freshly-constructed transport
    // (e.g. an init failure) before any sessionId exists.
    const destroy = vi.fn()
    const onclose = makeOnTransportClose(() => undefined, destroy)
    onclose()
    expect(destroy).not.toHaveBeenCalled()
  })

  it('treats empty-string sessionId as missing', () => {
    const destroy = vi.fn()
    const onclose = makeOnTransportClose(() => '', destroy)
    onclose()
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('reapIdleSessions', () => {
  it('does nothing when sessions are all fresh', () => {
    const sessions = new Map([
      ['s1', { lastActivity: 1000 }],
      ['s2', { lastActivity: 1100 }],
    ])
    const destroy = vi.fn()
    const log = { info: vi.fn() }
    reapIdleSessions(1500, 5000, sessions, destroy, log)
    expect(destroy).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalled()
  })

  it('destroys exactly the sessions older than ttlMs', () => {
    const sessions = new Map([
      ['fresh', { lastActivity: 9_000 }],
      ['old', { lastActivity: 1_000 }],
      ['oldest', { lastActivity: 100 }],
    ])
    const destroy = vi.fn()
    const log = { info: vi.fn() }
    // ttl 5_000 → "fresh" stays (now-fresh = 1_000 ≤ 5_000),
    // "old" goes (now-old = 9_000 > 5_000),
    // "oldest" goes (now-oldest = 9_900 > 5_000).
    reapIdleSessions(10_000, 5_000, sessions, destroy, log)
    expect(destroy).toHaveBeenCalledWith('old')
    expect(destroy).toHaveBeenCalledWith('oldest')
    expect(destroy).not.toHaveBeenCalledWith('fresh')
    expect(log.info).toHaveBeenCalledWith('Reaping idle session old')
    expect(log.info).toHaveBeenCalledWith('Reaping idle session oldest')
    expect(log.info).not.toHaveBeenCalledWith('Reaping idle session fresh')
  })

  it('does nothing on an empty session map', () => {
    const destroy = vi.fn()
    const log = { info: vi.fn() }
    reapIdleSessions(1, 1, new Map(), destroy, log)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('uses strict greater-than for the TTL boundary (equal is fresh enough)', () => {
    const sessions = new Map([['edge', { lastActivity: 5_000 }]])
    const destroy = vi.fn()
    const log = { info: vi.fn() }
    // now - lastActivity == ttlMs exactly → should NOT destroy.
    reapIdleSessions(10_000, 5_000, sessions, destroy, log)
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('handleRequestSafely', () => {
  it('runs the handler and returns silently when no error is thrown', async () => {
    const { res, writeHead, end } = makeRes()
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
    const { res, writeHead, end } = makeRes()
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
    const body = JSON.parse(end.mock.calls[0][0] as string)
    expect(body.error.code).toBe(-32603)
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
      // eslint-disable-next-line no-throw-literal -- exercising the non-Error path.
      throw 'plain string error'
    })
    expect(log.error).toHaveBeenCalledWith(
      'Error processing POST request: plain string error',
    )
  })
})

describe('module-level constants', () => {
  it('exposes the OAuth well-known path', () => {
    expect(OAUTH_WELL_KNOWN_PATH).toBe(
      '/.well-known/oauth-authorization-server',
    )
  })

  it('exposes the protected-resource metadata path', () => {
    expect(OAUTH_PROTECTED_RESOURCE_METADATA_PATH).toBe(
      '/.well-known/oauth-protected-resource',
    )
  })
})
