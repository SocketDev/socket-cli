/**
 * Unit tests for the MCP HTTP transport's header/URL and scope/origin helpers.
 *
 * These small functions handle header normalization, base-URL construction,
 * scope splitting, and origin classification. Pulled out of transport-http.mts
 * so they can be exercised directly without booting an HTTP server.
 *
 * Test Coverage (100% target): - getRequestHeaderValue: undefined / string /
 * array / empty array - getForwardedHeaderValue: empty / single / comma-list /
 * whitespace - getRequestBaseUrl: trustProxy on/off × forwarded headers
 * present/missing × tls / non-tls socket × forwarded-proto valid/invalid -
 * splitScopes: non-string / empty string / single / multiple / extra ws -
 * isLocalhostOrigin: localhost / 127.0.0.1 / other / malformed URL.
 *
 * Related Files: - src/commands/mcp/transport-http-helpers.mts - Implementation
 * - src/commands/mcp/transport-http.mts - Caller (HTTP server)
 */

import { describe, expect, it } from 'vitest'

import type { IncomingMessage } from 'node:http'

import {
  getForwardedHeaderValue,
  getRequestBaseUrl,
  getRequestHeaderValue,
  isLocalhostOrigin,
  splitScopes,
} from '../../../../src/commands/mcp/transport-http-helpers.mts'

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
