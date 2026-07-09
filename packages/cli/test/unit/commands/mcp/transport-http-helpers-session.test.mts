/**
 * Unit tests for the MCP HTTP transport's session-lifecycle helpers.
 *
 * Test Coverage (100% target): - destroySessionEntry: unknown id / close +
 * log / swallowed sync throw / swallowed async rejection -
 * makeOnTransportClose: sessionId present / missing / empty - reapIdleSessions:
 * fresh sessions / ttl boundary / empty map - handleRequestSafely: success /
 * thrown error / already-streaming / non-Error throw - module-level constants.
 *
 * Related Files: - src/commands/mcp/transport-http-helpers.mts - Implementation
 * - src/commands/mcp/transport-http.mts - Caller (HTTP server)
 */

import { describe, expect, it, vi } from 'vitest'

import type { ServerResponse } from 'node:http'

import {
  destroySessionEntry,
  handleRequestSafely,
  makeOnTransportClose,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  OAUTH_WELL_KNOWN_PATH,
  reapIdleSessions,
} from '../../../../src/commands/mcp/transport-http-helpers.mts'

import type { SessionLike } from '../../../../src/commands/mcp/transport-http-helpers.mts'

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
      ['fresh', { lastActivity: 9000 }],
      ['old', { lastActivity: 1000 }],
      ['oldest', { lastActivity: 100 }],
    ])
    const destroy = vi.fn()
    const log = { info: vi.fn() }
    // ttl 5_000 → "fresh" stays (now-fresh = 1_000 ≤ 5_000),
    // "old" goes (now-old = 9_000 > 5_000),
    // "oldest" goes (now-oldest = 9_900 > 5_000).
    reapIdleSessions(10_000, 5000, sessions, destroy, log)
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
    const sessions = new Map([['edge', { lastActivity: 5000 }]])
    const destroy = vi.fn()
    const log = { info: vi.fn() }
    // now - lastActivity == ttlMs exactly → should NOT destroy.
    reapIdleSessions(10_000, 5000, sessions, destroy, log)
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
