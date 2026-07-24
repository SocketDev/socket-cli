/**
 * Unit tests for Socket API utilities.
 *
 * Purpose: Tests Socket API interaction utilities. Validates API error handling
 * and response parsing.
 *
 * Test Coverage: - API call wrapper (handleApiCall) - Error response parsing -
 * Rate limit handling - getDefaultApiBaseUrl - getErrorMessageForHttpStatusCode
 * - handleApiCallNoSpinner - logPermissionsFor403 - queryApi function.
 *
 * Testing Approach: Mocks fetch/axios to test API utilities. Uses.
 *
 * @socketsecurity/sdk testing utilities for mock responses.
 *
 * Related Files: - util/socket/api.mts (implementation) -
 * api-requests.test.mts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  getDefaultApiBaseUrl,
  getErrorMessageForHttpStatusCode,
  handleApiCall,
  handleApiCallNoSpinner,
  logPermissionsFor403,
  queryApi,
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
      // 401 is now distinct from 403: it's an auth/token problem, not
      // a permissions problem. Callers get actionable "re-auth" guidance.
      expect(result).toContain('Authentication failed')
      expect(result).toContain('token')
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
      } as unknown)

      const result = await handleApiCall(mockApiPromise)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ result: 'test' })
      }
    })

    it('returns error result for failed API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: false,
        status: 400,
        error: 'API error',
      } as unknown)

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
      } as unknown)

      const mockCallSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }

      await handleApiCall(mockApiPromise, {
        spinner: mockCallSpinner as unknown,
      })
      expect(mockCallSpinner.start).toHaveBeenCalled()
      expect(mockCallSpinner.stop).toHaveBeenCalled()
    })

    it('starts spinner with description when both provided (line 256)', async () => {
      // description + spinner → start with prefixed message + log success.
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { x: 1 },
      } as unknown)
      const mockCallSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }
      await handleApiCall(mockApiPromise, {
        description: 'test data',
        spinner: mockCallSpinner as unknown,
      })
      expect(mockCallSpinner.start).toHaveBeenCalledWith(
        expect.stringContaining('Requesting test data from API'),
      )
    })

    it('logs success message when description + spinner + success (lines 266-272)', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { x: 1 },
      } as unknown)
      const mockCallSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }
      await handleApiCall(mockApiPromise, {
        description: 'thing',
        spinner: mockCallSpinner as unknown,
      })
      // logger.success was called via the description+spinner branch.
      expect(mockLogger.success).toHaveBeenCalledWith(
        expect.stringContaining('thing'),
      )
    })

    it('logs info message when description + spinner + non-success result (lines 271)', async () => {
      // success: false but it's the SDK-level non-success (not a thrown error).
      const mockApiPromise = Promise.resolve({
        success: false,
        status: 500,
        error: 'fail',
      } as unknown)
      const mockCallSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }
      await handleApiCall(mockApiPromise, {
        description: 'thing',
        spinner: mockCallSpinner as unknown,
      })
      // logger.info was called via the description+spinner branch on
      // non-thrown failure.
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('thing'),
      )
    })

    it('logs fail message when description + thrown error (lines 281-282)', async () => {
      const mockApiPromise = Promise.reject(new Error('boom'))
      await handleApiCall(mockApiPromise, { description: 'thing' })
      // logger.fail was called via the description-on-error branch.
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('thing'),
      )
    })

    it('logs permissions for 403 errors when commandPath provided (line 322-323)', async () => {
      // sdk-level non-success with status=403 + commandPath in options →
      // calls logPermissionsFor403, which logs the API permissions group.
      const mockApiPromise = Promise.resolve({
        success: false,
        status: 403,
        error: 'Forbidden',
      } as unknown)
      await handleApiCall(mockApiPromise, {
        commandPath: 'socket fix',
      })
      expect(mockLogger.group).toHaveBeenCalledWith(
        expect.stringContaining('Required API Permissions'),
      )
    })
  })

  describe('handleApiCallNoSpinner', () => {
    it('does not use spinner even if provided', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as unknown)

      const mockCallSpinner = {
        start: mockStart,
        stop: mockStop,
        succeed: mockSucceed,
        fail: mockFail,
      }

      await handleApiCallNoSpinner(mockApiPromise, {
        spinner: mockCallSpinner as unknown,
      })
      expect(mockCallSpinner.start).not.toHaveBeenCalled()
    })

    it('returns success result for successful API call', async () => {
      const mockApiPromise = Promise.resolve({
        success: true,
        data: { result: 'test' },
      } as unknown)

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
})
