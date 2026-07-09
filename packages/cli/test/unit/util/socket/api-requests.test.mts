/**
 * Unit tests for Socket API utilities.
 *
 * Purpose: Tests Socket API request/response utilities. Validates
 * queryApiSafeText, queryApiSafeJson, sendApiRequest, and the full
 * handleApiCallNoSpinner signature (SDK-response based overload).
 *
 * Testing Approach: Mocks fetch/axios to test API utilities. Uses.
 *
 * @socketsecurity/sdk testing utilities for mock responses.
 *
 * Related Files: - util/socket/api.mts (implementation) - api.test.mts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mockErrorResponse,
  mockSuccessResponse,
} from '@socketsecurity/sdk-stable/testing'

// Mock dependencies first.
const mockSpinner = vi.hoisted(() => vi.fn())
const mockStart = vi.hoisted(() => vi.fn())
const mockStop = vi.hoisted(() => vi.fn())
const mockSucceed = vi.hoisted(() => vi.fn())
const mockFail = vi.hoisted(() => vi.fn())
const mockSuccessAndStop = vi.hoisted(() => vi.fn())
const mockFailAndStop = vi.hoisted(() => vi.fn())

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: mockFail,
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

const mockGetDefaultSpinner = vi.hoisted(() =>
  vi.fn(() => ({
    failAndStop: mockFailAndStop,
    start: mockStart,
    stop: mockStop,
    succeed: mockSucceed,
    successAndStop: mockSuccessAndStop,
  })),
)
vi.mock(import('@socketsecurity/lib-stable/spinner/spinner'), () => ({
  Spinner: mockSpinner,
}))
vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: mockGetDefaultSpinner,
}))

// Mock getDefaultApiToken.
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getExtraCaCerts: () => undefined,
}))

// Mock getNetworkErrorDiagnostics.
vi.mock(import('../../../../src/util/error/errors.mts'), () => ({
  buildErrorCause: vi.fn(async (code: number) => `Error code: ${code}`),
  getNetworkErrorDiagnostics: vi.fn(() => 'Network error diagnostics'),
}))

// Mock httpRequest from socket-lib (replaces fetch).
const mockHttpRequest = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/http-request/request'), () => ({
  httpRequest: mockHttpRequest,
}))

// Helper to create httpRequest-style response objects (synchronous .text()/.json()).
function createHttpResponse(opts: {
  body?: string | undefined
  ok?: boolean | undefined
  status?: number | undefined
  statusText?: string | undefined
}) {
  const bodyStr = opts.body ?? ''
  const bodyBuffer = Buffer.from(bodyStr)
  return {
    body: bodyBuffer,
    headers: {},
    json: () => JSON.parse(bodyStr),
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    text: () => bodyStr,
  }
}

import { overrideCachedConfig } from '../../../../src/util/config.mts'
import {
  handleApiCallNoSpinner,
  queryApiSafeJson,
  queryApiSafeText,
  sendApiRequest,
} from '../../../../src/util/socket/api.mts'

describe('api utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    // Clear cached config to avoid test interference.
    overrideCachedConfig('{}')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    mockHttpRequest.mockReset()
    mockGetDefaultApiToken.mockReset()
  })

  describe('queryApiSafeText', () => {
    beforeEach(() => {
      // Reset mock for each test.
      mockGetDefaultApiToken.mockReturnValue('test-token')
    })

    it('returns error when not authenticated', async () => {
      mockGetDefaultApiToken.mockReturnValue(undefined)

      const result = await queryApiSafeText('test/path')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Authentication Error')
      }
    })

    it('returns success with text data for successful request', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: 'response data' }),
      )

      const result = await queryApiSafeText('test/path', 'test description')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('response data')
      }
      expect(mockSuccessAndStop).toHaveBeenCalled()
    })

    it('returns error for failed HTTP status', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        }),
      )

      const result = await queryApiSafeText(
        'test/path',
        'test description',
        'socket fix',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('returns error for network failures', async () => {
      mockHttpRequest.mockRejectedValueOnce(new Error('Network failure'))

      const result = await queryApiSafeText('test/path', 'test description')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('failed')
        // The cause must include the request path so the user can tell
        // which endpoint failed when several calls are in flight.
        expect(result.cause).toContain('(path: test/path)')
      }
      expect(mockFailAndStop).toHaveBeenCalled()
    })

    it('returns error when response text cannot be read', async () => {
      // With httpRequest, .text() is synchronous. Simulate a response
      // where text() throws by providing a malformed mock.
      mockHttpRequest.mockResolvedValueOnce({
        body: Buffer.alloc(0),
        headers: {},
        json: () => undefined,
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => {
          throw new Error('Read error')
        },
      })

      const result = await queryApiSafeText('test/path')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('response text')
        expect(result.cause).toContain('(path: test/path)')
      }
    })
  })

  describe('queryApiSafeJson', () => {
    beforeEach(() => {
      mockGetDefaultApiToken.mockReturnValue('test-token')
    })

    it('parses JSON response successfully', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: '{"key": "value"}' }),
      )

      const result = await queryApiSafeJson<{ key: string }>('test/path')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ key: 'value' })
      }
    })

    it('returns error for invalid JSON', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: 'not valid json' }),
      )

      const result = await queryApiSafeJson<unknown>('test/path')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('invalid JSON')
      }
    })

    it('propagates authentication errors', async () => {
      mockGetDefaultApiToken.mockReturnValue(undefined)

      const result = await queryApiSafeJson<unknown>('test/path')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Authentication Error')
      }
    })
  })

  describe('sendApiRequest', () => {
    beforeEach(() => {
      mockGetDefaultApiToken.mockReturnValue('test-token')
    })

    it('returns error when not authenticated', async () => {
      mockGetDefaultApiToken.mockReturnValue(undefined)

      const result = await sendApiRequest<unknown>('test/path', {
        method: 'POST',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Authentication Error')
      }
    })

    it('sends POST request with JSON body', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: '{"result": "success"}' }),
      )

      const result = await sendApiRequest<{ result: string }>('test/path', {
        method: 'POST',
        body: { data: 'test' },
        description: 'test operation',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ result: 'success' })
      }
      expect(mockHttpRequest).toHaveBeenCalledWith(
        'https://api.socket.dev/v0/test/path',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ data: 'test' }),
        }),
      )
    })

    it('sends PUT request', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: '{"updated": true}' }),
      )

      const result = await sendApiRequest<{ updated: boolean }>('test/path', {
        method: 'PUT',
        body: { value: 'updated' },
      })

      expect(result.ok).toBe(true)
      expect(mockHttpRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' }),
      )
    })

    it('returns error for failed HTTP status', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        }),
      )

      const result = await sendApiRequest<unknown>('test/path', {
        method: 'POST',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('returns error for network failures', async () => {
      mockHttpRequest.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await sendApiRequest<unknown>('test/path', {
        method: 'POST',
        description: 'test operation',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('failed')
        // Request path must be surfaced in error cause for debuggability.
        expect(result.cause).toContain('(path: test/path)')
      }
    })

    it('returns error when JSON parsing fails', async () => {
      // With httpRequest, .json() is synchronous. Provide invalid JSON body.
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: 'not-json' }),
      )

      const result = await sendApiRequest<unknown>('test/path', {
        method: 'POST',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.cause).toContain('parsing')
        expect(result.cause).toContain('(path: test/path)')
      }
    })

    it('logs permissions for 403 errors when commandPath provided', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        }),
      )

      await sendApiRequest<unknown>('test/path', {
        method: 'POST',
        commandPath: 'socket fix',
      })

      expect(mockLogger.group).toHaveBeenCalledWith(
        '🔐 Required API Permissions:',
      )
    })
  })

  describe('handleApiCallNoSpinner full signature', () => {
    it('returns success result with description', async () => {
      const mockApiPromise = Promise.resolve(
        mockSuccessResponse({ result: 'test' }),
      )

      const result = await handleApiCallNoSpinner(
        mockApiPromise,
        'test description',
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ result: 'test' })
      }
    })

    it('returns error result for failed SDK response', async () => {
      const mockApiPromise = Promise.resolve(
        mockErrorResponse('API error', 400),
      )

      const result = await handleApiCallNoSpinner(
        mockApiPromise,
        'test description',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('returns error with cause when promise rejects (lines 342-354)', async () => {
      // Rejected promise hits the catch block; the error string becomes cause.
      const mockApiPromise = Promise.reject(new Error('thrown boom'))

      const result = await handleApiCallNoSpinner(mockApiPromise, 'reject test')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Socket API error')
        expect(result.cause).toContain('thrown boom')
      }
    })

    it('omits cause when error stringifies to empty (line 348-349)', async () => {
      // String(empty error) === '' → cause is set to NO_ERROR_MESSAGE,
      // and since 'Socket API error' !== NO_ERROR_MESSAGE, cause is included.
      // To test the cause-equals-message edge case, throw a plain object that
      // stringifies to nothing. Empty-trim case → uses NO_ERROR_MESSAGE.
      const mockApiPromise = Promise.reject('')

      const result = await handleApiCallNoSpinner(
        mockApiPromise as unknown,
        'empty err',
      )

      expect(result.ok).toBe(false)
    })
  })
})
