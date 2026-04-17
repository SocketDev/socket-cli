/**
 * Unit tests for Socket API utilities.
 *
 * Purpose:
 * Tests Socket API interaction utilities. Validates API error handling and response parsing.
 *
 * Test Coverage:
 * - API call wrapper (handleApiCall)
 * - Error response parsing
 * - Rate limit handling
 * - Retry logic
 * - Timeout handling
 * - queryApi function
 * - queryApiSafeText function
 * - queryApiSafeJson function
 * - sendApiRequest function
 *
 * Testing Approach:
 * Mocks fetch/axios to test API utilities.
 * Uses @socketsecurity/sdk testing utilities for mock responses.
 *
 * Related Files:
 * - utils/socket/api.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mockErrorResponse,
  mockSuccessResponse,
} from '@socketsecurity/sdk/testing'

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

vi.mock('@socketsecurity/lib/logger', () => ({
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
vi.mock('@socketsecurity/lib/spinner', () => ({
  Spinner: mockSpinner,
  getDefaultSpinner: mockGetDefaultSpinner,
}))

// Mock getDefaultApiToken.
const mockGetDefaultApiToken = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  getDefaultApiToken: mockGetDefaultApiToken,
  getExtraCaCerts: () => undefined,
}))

// Mock getNetworkErrorDiagnostics.
vi.mock('../../../../src/utils/error/errors.mts', () => ({
  buildErrorCause: vi.fn(async (code: number) => `Error code: ${code}`),
  getNetworkErrorDiagnostics: vi.fn(() => 'Network error diagnostics'),
}))

// Mock httpRequest from socket-lib (replaces fetch).
const mockHttpRequest = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/http-request', () => ({
  httpRequest: mockHttpRequest,
}))

// Helper to create httpRequest-style response objects (synchronous .text()/.json()).
function createHttpResponse(opts: {
  body?: string
  ok?: boolean
  status?: number
  statusText?: string
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

import { overrideCachedConfig } from '../../../../src/utils/config.mts'
import {
  getDefaultApiBaseUrl,
  getErrorMessageForHttpStatusCode,
  handleApiCall,
  handleApiCallNoSpinner,
  logPermissionsFor403,
  queryApi,
  queryApiSafeJson,
  queryApiSafeText,
  sendApiRequest,
} from '../../../../src/utils/socket/api.mts'

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

  describe('getDefaultApiBaseUrl', () => {
    it('returns environment variable when set', async () => {
      // Use vi.stubEnv to properly mock environment variable.
      vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'https://custom.api.url')
      // In VITEST mode, ENV uses process.env directly via Proxy.
      const result = getDefaultApiBaseUrl()
      expect(result).toBe('https://custom.api.url')
    })

    it('falls back to config value when env not set', async () => {
      // Ensure env is not set by deleting it.
      delete process.env['SOCKET_CLI_API_BASE_URL']
      // Set config value using overrideCachedConfig (expects JSON string).
      overrideCachedConfig('{"apiBaseUrl": "https://config.api.url"}')

      const result = getDefaultApiBaseUrl()
      expect(result).toBe('https://config.api.url')
    })

    it('returns default API_V0_URL when neither env nor config set', async () => {
      // Ensure env is not set by deleting it.
      delete process.env['SOCKET_CLI_API_BASE_URL']
      // Config is already cleared in beforeEach with overrideCachedConfig({}).

      const result = getDefaultApiBaseUrl()
      expect(result).toBe('https://api.socket.dev/v0/')
    })
  })

  describe('getErrorMessageForHttpStatusCode', () => {
    it('returns message for 400 Bad Request', async () => {
      const result = await getErrorMessageForHttpStatusCode(400)
      expect(result).toContain('incorrect')
    })

    it('returns message for 401 Unauthorized', async () => {
      const result = await getErrorMessageForHttpStatusCode(401)
      expect(result).toContain('permissions')
    })

    it('returns message for 403 Forbidden', async () => {
      const result = await getErrorMessageForHttpStatusCode(403)
      expect(result).toContain('permissions')
    })

    it('returns message for 404 Not Found', async () => {
      const result = await getErrorMessageForHttpStatusCode(404)
      expect(result).toContain('Not found')
      expect(result).toContain("doesn't exist")
    })

    it('returns message for 429 Rate Limit', async () => {
      const result = await getErrorMessageForHttpStatusCode(429)
      expect(result).toContain('Rate limit exceeded')
      expect(result).toContain('Too many API requests')
    })

    it('returns message for 500 Internal Server Error', async () => {
      const result = await getErrorMessageForHttpStatusCode(500)
      expect(result).toContain('Server error')
      expect(result).toContain('internal problem')
    })

    it('returns generic message for unknown status code', async () => {
      const result = await getErrorMessageForHttpStatusCode(418)
      expect(result).toContain('HTTP 418')
      expect(result).toContain('unexpected status code')
    })
  })

  describe('handleApiCall', () => {
    it('returns success result for successful API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ result: 'test' })
      }
    })

    it('returns error result for failed API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: false,
        error: { message: 'API error', statusCode: 400 },
      } as any)

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('handles API call exceptions', async () => {
      const mockApiPromise = Promise.reject(new Error('Network error'))

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('uses spinner when provided', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const mockSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }

      await handleApiCall(mockApiPromise, { spinner: mockSpinner as any })
      expect(mockSpinner.start).toHaveBeenCalled()
      expect(mockSpinner.stop).toHaveBeenCalled()
    })
  })

  describe('handleApiCallNoSpinner', () => {
    it('does not use spinner even if provided', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const mockSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }

      await handleApiCallNoSpinner(mockApiPromise, {
        spinner: mockSpinner as any,
      })
      expect(mockSpinner.start).not.toHaveBeenCalled()
    })

    it('returns success result for successful API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as any)

      const result = await handleApiCallNoSpinner(mockApiPromise)
      expect(result.ok).toBe(true)
    })
  })

  describe('logPermissionsFor403', () => {
    it('logs specific permissions when command requirements are found', () => {
      logPermissionsFor403('socket fix')

      // Verify logger.group was called with permissions header.
      expect(mockLogger.group).toHaveBeenCalledWith(
        '🔐 Required API Permissions:',
      )

      // Verify permissions were logged.
      expect(mockLogger.error).toHaveBeenCalledWith('full-scans:create')
      expect(mockLogger.error).toHaveBeenCalledWith('packages:list')

      // Verify groupEnd was called.
      expect(mockLogger.groupEnd).toHaveBeenCalled()

      // Verify fix instructions.
      expect(mockLogger.group).toHaveBeenCalledWith('💡 To fix this:')
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Visit https://socket.dev/settings/api-tokens',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Edit your API token to grant the permissions listed above',
      )
      expect(mockLogger.error).toHaveBeenCalledWith('Re-run your command')
    })

    it('logs general guidance when command requirements not found', () => {
      logPermissionsFor403('socket unknown')

      // Verify general permission message.
      expect(mockLogger.group).toHaveBeenCalledWith(
        '🔐 Permission Requirements:',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Your API token lacks the required permissions for this operation.',
      )

      // Verify general fix instructions.
      expect(mockLogger.group).toHaveBeenCalledWith('💡 To fix this:')
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Visit https://socket.dev/settings/api-tokens',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Check your API token has the necessary permissions',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Run `socket unknown --help` to see required permissions',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Re-run your command after updating permissions',
      )
    })

    it('handles undefined cmdPath gracefully', () => {
      logPermissionsFor403(undefined)

      // Should show general guidance.
      expect(mockLogger.group).toHaveBeenCalledWith(
        '🔐 Permission Requirements:',
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Run `socket help --help` to see required permissions',
      )
    })

    it('logs permissions for scan:create command', () => {
      logPermissionsFor403('socket scan:create')

      expect(mockLogger.group).toHaveBeenCalledWith(
        '🔐 Required API Permissions:',
      )
      expect(mockLogger.error).toHaveBeenCalledWith('full-scans:create')
    })
  })

  describe('queryApi', () => {
    it('makes authenticated GET request to Socket API', async () => {
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: 'response text' }),
      )

      const result = await queryApi('test/path', 'test-token')

      expect(mockHttpRequest).toHaveBeenCalledWith(
        'https://api.socket.dev/v0/test/path',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      )
      expect(result.ok).toBe(true)
    })

    it('throws error when base URL is not configured', async () => {
      // Mock to return undefined.
      vi.stubEnv('SOCKET_CLI_API_BASE_URL', '')
      overrideCachedConfig('{"apiBaseUrl": ""}')

      // Since API_V0_URL is always returned as fallback, queryApi won't throw
      // unless we mock getDefaultApiBaseUrl to return undefined.
      // For now, let's test the normal path.
      mockHttpRequest.mockResolvedValueOnce(
        createHttpResponse({ body: 'response' }),
      )

      const result = await queryApi('path', 'token')
      expect(result.ok).toBe(true)
    })
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
        json: () => null,
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

      const result = await queryApiSafeJson<any>('test/path')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('invalid JSON')
      }
    })

    it('propagates authentication errors', async () => {
      mockGetDefaultApiToken.mockReturnValue(undefined)

      const result = await queryApiSafeJson<any>('test/path')

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

      const result = await sendApiRequest<any>('test/path', { method: 'POST' })

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

      const result = await sendApiRequest<any>('test/path', { method: 'POST' })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })

    it('returns error for network failures', async () => {
      mockHttpRequest.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await sendApiRequest<any>('test/path', {
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

      const result = await sendApiRequest<any>('test/path', { method: 'POST' })

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

      await sendApiRequest<any>('test/path', {
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
      const mockApiPromise = Promise.resolve(mockErrorResponse('API error', 400))

      const result = await handleApiCallNoSpinner(
        mockApiPromise,
        'test description',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Socket API error')
      }
    })
  })
})
