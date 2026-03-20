/**
 * Unit tests for API utilities with extra CA certificate support.
 *
 * Purpose:
 * Tests the apiFetch wrapper that enables SSL_CERT_FILE support for
 * direct API calls when NODE_EXTRA_CA_CERTS is not set at process startup.
 *
 * Test Coverage:
 * - apiFetch falls back to regular fetch when no extra CA certs are needed.
 * - apiFetch uses node:https.request with custom agent when CA certs are set.
 * - Response object construction from https.request output.
 * - POST requests with JSON body through https.request path.
 * - Error propagation from https.request failures.
 *
 * Testing Approach:
 * Mocks node:https, node:fs, node:tls, and the SDK module to test the
 * apiFetch behavior in isolation without network calls.
 *
 * Related Files:
 * - utils/api.mts (implementation)
 * - utils/sdk.mts (getExtraCaCerts)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventEmitter } from 'node:events'

// Mock getExtraCaCerts from sdk.mts.
const mockGetExtraCaCerts = vi.hoisted(() => vi.fn(() => undefined))
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn(() => 'test-api-token'))
vi.mock('./sdk.mts', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getDefaultApiBaseUrl: vi.fn(() => undefined),
  getDefaultProxyUrl: vi.fn(() => undefined),
  getExtraCaCerts: mockGetExtraCaCerts,
}))

// Mock node:https request function.
type RequestCallback = (
  res: EventEmitter & {
    statusCode?: number
    statusMessage?: string
    headers: Record<string, string>
  },
) => void
const mockHttpsRequest = vi.hoisted(() => vi.fn())
const MockHttpsAgent = vi.hoisted(() =>
  vi.fn().mockImplementation(opts => ({ ...opts, _isHttpsAgent: true })),
)
vi.mock('node:https', () => ({
  Agent: MockHttpsAgent,
  request: mockHttpsRequest,
}))

// Mock constants.
vi.mock('../constants.mts', () => ({
  default: {
    API_V0_URL: 'https://api.socket.dev/v0/',
    ENV: {
      NODE_EXTRA_CA_CERTS: '',
      SOCKET_CLI_API_BASE_URL: 'https://api.socket.dev/v0/',
      SOCKET_CLI_API_TIMEOUT: 30_000,
    },
    spinner: {
      failAndStop: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      successAndStop: vi.fn(),
    },
  },
  CONFIG_KEY_API_BASE_URL: 'apiBaseUrl',
  EMPTY_VALUE: '<empty>',
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_UNAUTHORIZED: 401,
}))

// Mock config.
vi.mock('./config.mts', () => ({
  getConfigValueOrUndef: vi.fn(() => undefined),
}))

// Mock debug functions.
vi.mock('./debug.mts', () => ({
  debugApiRequest: vi.fn(),
  debugApiResponse: vi.fn(),
}))

// Mock requirements.
vi.mock('./requirements.mts', () => ({
  getRequirements: vi.fn(() => ({ api: {} })),
  getRequirementsKey: vi.fn(() => ''),
}))

// Mock telemetry.
vi.mock('./telemetry/integration.mts', () => ({
  trackCliEvent: vi.fn(),
}))

// Store original fetch for restoration.
const originalFetch = globalThis.fetch

describe('apiFetch with extra CA certificates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetExtraCaCerts.mockReturnValue(undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should use regular fetch when no extra CA certs are needed', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      statusText: 'OK',
    })
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse)

    const { queryApiSafeText } = await import('./api.mts')
    const result = await queryApiSafeText('test/path', 'test request')

    expect(globalThis.fetch).toHaveBeenCalled()
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('should use https.request when extra CA certs are available', async () => {
    const caCerts = ['ROOT_CERT', 'EXTRA_CERT']
    mockGetExtraCaCerts.mockReturnValue(caCerts)

    // Create a mock request object that simulates node:https.request.
    const mockReq = {
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
    }

    mockHttpsRequest.mockImplementation(
      (_url: string, _opts: unknown, callback: RequestCallback) => {
        // Simulate an async response.
        setTimeout(() => {
          const mockRes = {
            headers: { 'content-type': 'text/plain' },
            on: vi.fn(),
            statusCode: 200,
            statusMessage: 'OK',
          }
          // Capture data and end handlers.
          const handlers: Record<string, Function> = {}
          mockRes.on.mockImplementation((event: string, handler: Function) => {
            handlers[event] = handler
            return mockRes
          })
          callback(mockRes)
          // Emit data and end events.
          handlers['data']?.(Buffer.from('response body'))
          handlers['end']?.()
        }, 0)
        return mockReq
      },
    )

    const { queryApiSafeText } = await import('./api.mts')
    const result = await queryApiSafeText('test/path', 'test request')

    expect(mockHttpsRequest).toHaveBeenCalled()
    // Verify the agent was created with CA certs.
    expect(MockHttpsAgent).toHaveBeenCalledWith({ ca: caCerts })
    // Verify the request was made with the agent.
    const callArgs = mockHttpsRequest.mock.calls[0]
    expect(callArgs[1]).toEqual(
      expect.objectContaining({
        agent: expect.objectContaining({ ca: caCerts }),
        method: 'GET',
      }),
    )
  })

  it('should construct valid Response from https.request output', async () => {
    const caCerts = ['ROOT_CERT', 'EXTRA_CERT']
    mockGetExtraCaCerts.mockReturnValue(caCerts)

    const responseBody = JSON.stringify({ data: 'test-value' })
    const mockReq = {
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
    }

    mockHttpsRequest.mockImplementation(
      (_url: string, _opts: unknown, callback: RequestCallback) => {
        setTimeout(() => {
          const mockRes = {
            headers: { 'content-type': 'application/json' },
            on: vi.fn(),
            statusCode: 200,
            statusMessage: 'OK',
          }
          const handlers: Record<string, Function> = {}
          mockRes.on.mockImplementation((event: string, handler: Function) => {
            handlers[event] = handler
            return mockRes
          })
          callback(mockRes)
          handlers['data']?.(Buffer.from(responseBody))
          handlers['end']?.()
        }, 0)
        return mockReq
      },
    )

    const { queryApiSafeText } = await import('./api.mts')
    const result = await queryApiSafeText('test/path', 'test request')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBe(responseBody)
    }
  })

  it('should handle https.request errors gracefully', async () => {
    const caCerts = ['ROOT_CERT', 'EXTRA_CERT']
    mockGetExtraCaCerts.mockReturnValue(caCerts)

    const mockReq = {
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
    }

    // Simulate a connection error.
    mockHttpsRequest.mockImplementation(() => {
      // Capture the error handler and trigger it.
      const handlers: Record<string, Function> = {}
      mockReq.on.mockImplementation((event: string, handler: Function) => {
        handlers[event] = handler
        return mockReq
      })
      setTimeout(() => {
        handlers['error']?.(new Error('unable to get local issuer certificate'))
      }, 0)
      return mockReq
    })

    const { queryApiSafeText } = await import('./api.mts')
    const result = await queryApiSafeText('test/path', 'test request')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cause).toContain('unable to get local issuer certificate')
    }
  })

  it('should pass request body for POST requests through https.request', async () => {
    const caCerts = ['ROOT_CERT', 'EXTRA_CERT']
    mockGetExtraCaCerts.mockReturnValue(caCerts)

    const mockReq = {
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
    }

    mockHttpsRequest.mockImplementation(
      (_url: string, _opts: unknown, callback: RequestCallback) => {
        setTimeout(() => {
          const mockRes = {
            headers: { 'content-type': 'application/json' },
            on: vi.fn(),
            statusCode: 200,
            statusMessage: 'OK',
          }
          const handlers: Record<string, Function> = {}
          mockRes.on.mockImplementation((event: string, handler: Function) => {
            handlers[event] = handler
            return mockRes
          })
          callback(mockRes)
          handlers['data']?.(Buffer.from('{"result":"ok"}'))
          handlers['end']?.()
        }, 0)
        return mockReq
      },
    )

    const { sendApiRequest } = await import('./api.mts')
    const result = await sendApiRequest('test/path', {
      body: { key: 'value' },
      method: 'POST',
    })

    // Verify body was written to the request.
    expect(mockReq.write).toHaveBeenCalledWith('{"key":"value"}')
    expect(result.ok).toBe(true)
  })

  it('should handle multi-value response headers from https.request', async () => {
    const caCerts = ['ROOT_CERT', 'EXTRA_CERT']
    mockGetExtraCaCerts.mockReturnValue(caCerts)

    const mockReq = {
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
    }

    mockHttpsRequest.mockImplementation(
      (_url: string, _opts: unknown, callback: RequestCallback) => {
        setTimeout(() => {
          const mockRes = {
            headers: {
              'content-type': 'text/plain',
              'set-cookie': ['a=1', 'b=2'],
            },
            on: vi.fn(),
            statusCode: 200,
            statusMessage: 'OK',
          }
          const handlers: Record<string, Function> = {}
          mockRes.on.mockImplementation((event: string, handler: Function) => {
            handlers[event] = handler
            return mockRes
          })
          callback(mockRes as any)
          handlers['data']?.(Buffer.from('ok'))
          handlers['end']?.()
        }, 0)
        return mockReq
      },
    )

    const { queryApiSafeText } = await import('./api.mts')
    const result = await queryApiSafeText('test/path')

    expect(result.ok).toBe(true)
  })
})
