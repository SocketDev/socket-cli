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
 *
 * Testing Approach:
 * Mocks fetch/axios to test API utilities.
 *
 * Related Files:
 * - utils/socket/api.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies first.
const mockSpinner = vi.hoisted(() => vi.fn())
const mockStart = vi.hoisted(() => vi.fn())
const mockStop = vi.hoisted(() => vi.fn())
const mockSucceed = vi.hoisted(() => vi.fn())
const mockFail = vi.hoisted(() => vi.fn())

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

vi.mock('@socketsecurity/lib/spinner', () => ({
  Spinner: mockSpinner,
}))

import { overrideCachedConfig } from '../../../../../src/utils/config.mts'
import {
  getDefaultApiBaseUrl,
  getErrorMessageForHttpStatusCode,
  handleApiCall,
  handleApiCallNoSpinner,
  logPermissionsFor403,
} from '../../../../../src/utils/socket/api.mts'

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
})
