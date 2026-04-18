/**
 * Unit tests for debug utilities.
 *
 * Purpose:
 * Tests debug logging and diagnostic utilities. Validates conditional logging and debug mode detection.
 *
 * Test Coverage:
 * - Debug mode detection
 * - Conditional logging
 * - Log level filtering
 * - Debug namespace support
 * - Performance timing
 *
 * Testing Approach:
 * Tests debug utility functions with environment variable mocking.
 *
 * Related Files:
 * - utils/debug.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the registry debug functions.
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugCache = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())
const mockDebugDirNs = vi.hoisted(() => vi.fn())
const mockDebugNs = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn(() => false))
const mockIsDebugNs = vi.hoisted(() => vi.fn(() => false))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugCache: mockDebugCache,
  debugDir: mockDebugDir,
  debugDirNs: mockDebugDirNs,
  debugNs: mockDebugNs,
  isDebug: mockIsDebug,
  isDebugNs: mockIsDebugNs,
}))

import { debug, debugDir, debugNs } from '@socketsecurity/lib/debug'

import {
  debugApiRequest,
  debugApiResponse,
  debugConfig,
  debugFileOp,
  debugGit,
  debugScan,
} from '../../../src/utils/debug.mts'

describe('debug utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDebug.mockReturnValue(false)
    mockIsDebugNs.mockReturnValue(false)
  })

  describe('debugApiRequest', () => {
    it('logs request when silly debug is enabled', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugApiRequest('GET', '/api/test', 5000)

      expect(debugNs).toHaveBeenCalled()
      const call = mockDebugNs.mock.calls[0]
      expect(call?.[0]).toBe('silly')
      expect(call?.[1]).toContain('GET')
      expect(call?.[1]).toContain('/api/test')
      expect(call?.[1]).toContain('5000ms')
    })

    it('does not log when silly debug is disabled', () => {
      mockIsDebugNs.mockReturnValue(false)

      debugApiRequest('POST', '/api/scan', 10000)

      expect(debugNs).not.toHaveBeenCalled()
    })

    it('handles request without timeout', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugApiRequest('DELETE', '/api/resource')

      expect(debugNs).toHaveBeenCalled()
      const call = mockDebugNs.mock.calls[0]
      expect(call?.[1]).toContain('DELETE')
      expect(call?.[1]).not.toContain('timeout')
    })
  })

  describe('debugApiResponse', () => {
    it('logs error when error is provided', () => {
      const error = new Error('API failed')

      debugApiResponse('/api/test', undefined, error)

      expect(debugDir).toHaveBeenCalledWith({
        endpoint: '/api/test',
        error: 'API failed',
      })
    })

    it('logs warning for HTTP error status codes', () => {
      debugApiResponse('/api/test', 404)

      expect(debug).toHaveBeenCalledWith('API /api/test: HTTP 404')
    })

    it('logs notice for successful responses when debug is enabled', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugApiResponse('/api/test', 200)

      expect(debugNs).toHaveBeenCalledWith('notice', 'API /api/test: 200')
    })

    it('does not log for successful responses when debug is disabled', () => {
      mockIsDebugNs.mockReturnValue(false)

      debugApiResponse('/api/test', 200)

      expect(debugNs).not.toHaveBeenCalled()
    })

    it('handles non-Error objects in error parameter', () => {
      debugApiResponse('/api/test', undefined, 'String error')

      expect(debugDir).toHaveBeenCalledWith({
        endpoint: '/api/test',
        error: 'Unknown error',
      })
    })

    it('includes request info in error logging', () => {
      const error = new Error('Request failed')
      const requestInfo = {
        method: 'POST',
        url: 'https://api.socket.dev/test',
        durationMs: 1500,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        },
      }

      debugApiResponse('/api/test', undefined, error, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.method).toBe('POST')
      expect(calledWith.url).toBe('https://api.socket.dev/test')
      expect(calledWith.durationMs).toBe(1500)
      // Authorization should be redacted.
      expect(calledWith.headers?.Authorization).toBe('[REDACTED]')
      expect(calledWith.headers?.['Content-Type']).toBe('application/json')
    })

    it('includes request info in HTTP error logging', () => {
      const requestInfo = {
        method: 'GET',
        url: 'https://api.socket.dev/resource',
        durationMs: 500,
        headers: {
          'x-api-key': 'my-api-key',
        },
      }

      debugApiResponse('/api/resource', 500, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.status).toBe(500)
      expect(calledWith.method).toBe('GET')
      // API key should be redacted.
      expect(calledWith.headers?.['x-api-key']).toBe('[REDACTED]')
    })

    it('handles partial request info', () => {
      const requestInfo = {
        method: 'PUT',
      }

      debugApiResponse('/api/update', 400, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.method).toBe('PUT')
      expect(calledWith.url).toBeUndefined()
      expect(calledWith.headers).toBeUndefined()
    })

    it('includes requestedAt timestamp when provided', () => {
      const requestInfo = {
        method: 'POST',
        url: 'https://api.socket.dev/x',
        requestedAt: '2026-04-18T00:00:00.000Z',
      }

      debugApiResponse('/api/x', 500, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.requestedAt).toBe('2026-04-18T00:00:00.000Z')
    })

    it('extracts cf-ray as a top-level field and keeps responseHeaders', () => {
      const requestInfo = {
        method: 'GET',
        url: 'https://api.socket.dev/y',
        responseHeaders: {
          'cf-ray': 'abc123-IAD',
          'content-type': 'application/json',
        },
      }

      debugApiResponse('/api/y', 500, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.cfRay).toBe('abc123-IAD')
      expect(calledWith.responseHeaders?.['cf-ray']).toBe('abc123-IAD')
    })

    it('tolerates CF-Ray header casing', () => {
      const requestInfo = {
        method: 'GET',
        url: 'https://api.socket.dev/z',
        responseHeaders: {
          'CF-Ray': 'xyz789-SJC',
        },
      }

      debugApiResponse('/api/z', 500, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.cfRay).toBe('xyz789-SJC')
    })

    it('includes response body on error', () => {
      const requestInfo = {
        method: 'GET',
        url: 'https://api.socket.dev/body',
        responseBody: '{"error":"bad"}',
      }

      debugApiResponse('/api/body', 400, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.responseBody).toBe('{"error":"bad"}')
    })

    it('truncates oversized response bodies', () => {
      const bigBody = 'x'.repeat(5000)
      const requestInfo = {
        method: 'GET',
        url: 'https://api.socket.dev/big',
        responseBody: bigBody,
      }

      debugApiResponse('/api/big', 500, undefined, requestInfo)

      const calledWith = mockDebugDir.mock.calls[0]?.[0]
      expect(calledWith.responseBody).toMatch(/… \(truncated, 5000 bytes\)$/)
      expect((calledWith.responseBody as string).length).toBeLessThan(
        bigBody.length,
      )
    })
  })

  describe('debugFileOp', () => {
    it('logs warning when error occurs', () => {
      const error = new Error('File not found')

      debugFileOp('read', '/path/to/file', error)

      expect(debugDir).toHaveBeenCalledWith({
        operation: 'read',
        filepath: '/path/to/file',
        error: 'File not found',
      })
    })

    it('logs silly level for successful operations when enabled', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugFileOp('write', '/path/to/file')

      expect(debugNs).toHaveBeenCalledWith('silly', 'File write: /path/to/file')
    })

    it('does not log for successful operations when silly is disabled', () => {
      mockIsDebugNs.mockReturnValue(false)

      debugFileOp('create', '/path/to/file')

      expect(debugNs).not.toHaveBeenCalled()
    })

    it('handles all operation types', () => {
      const operations: Array<'read' | 'write' | 'delete' | 'create'> = [
        'read',
        'write',
        'delete',
        'create',
      ]

      operations.forEach(op => {
        debugFileOp(op, `/path/${op}`)
        // No errors expected.
      })
    })
  })

  describe('debugScan', () => {
    it('logs start phase with package count', () => {
      debugScan('start', 42)

      expect(debug).toHaveBeenCalledWith('Scanning 42 packages')
    })

    it('does not log start phase without package count', () => {
      debugScan('start')

      expect(debug).not.toHaveBeenCalled()
    })

    it('logs progress when silly debug is enabled', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugScan('progress', 10)

      expect(debugNs).toHaveBeenCalledWith(
        'silly',
        'Scan progress: 10 packages processed',
      )
    })

    it('logs complete phase', () => {
      debugScan('complete', 50)

      expect(debugNs).toHaveBeenCalledWith(
        'notice',
        'Scan complete: 50 packages',
      )
    })

    it('logs complete phase without package count', () => {
      debugScan('complete')

      expect(debugNs).toHaveBeenCalledWith('notice', 'Scan complete')
    })

    it('logs error phase with details', () => {
      const errorDetails = { message: 'Scan failed' }

      debugScan('error', undefined, errorDetails)

      expect(debugDir).toHaveBeenCalledWith({
        phase: 'scan_error',
        details: errorDetails,
      })
    })
  })

  describe('debugConfig', () => {
    it('logs error when provided', () => {
      const error = new Error('Config invalid')

      debugConfig('.socketrc', false, error)

      expect(debugDir).toHaveBeenCalledWith({
        source: '.socketrc',
        error: 'Config invalid',
      })
    })

    it('logs notice when config is found', () => {
      debugConfig('.socketrc', true)

      expect(debug).toHaveBeenCalledWith('Config loaded: .socketrc')
    })

    it('logs silly when config not found and debug enabled', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugConfig('.socketrc', false)

      expect(debugNs).toHaveBeenCalledWith(
        'silly',
        'Config not found: .socketrc',
      )
    })

    it('does not log when config not found and debug disabled', () => {
      mockIsDebugNs.mockReturnValue(false)

      debugConfig('.socketrc', false)

      expect(debugNs).not.toHaveBeenCalled()
    })
  })

  describe('debugGit', () => {
    it('logs warning for failed operations', () => {
      debugGit('push', false, { branch: 'main' })

      expect(debugDir).toHaveBeenCalledWith({
        git_op: 'push',
        branch: 'main',
      })
    })

    it('logs notice for important successful operations', () => {
      mockIsDebugNs.mockImplementation(level => level === 'notice')

      debugGit('push', true)

      expect(debugNs).toHaveBeenCalledWith('notice', 'Git push succeeded')
    })

    it('logs commit operations', () => {
      mockIsDebugNs.mockReturnValue(true)

      debugGit('commit', true)

      expect(debugNs).toHaveBeenCalledWith('notice', 'Git commit succeeded')
    })

    it('logs other operations only with silly debug', () => {
      mockIsDebugNs.mockImplementation(level => level === 'silly')

      debugGit('status', true)

      expect(debugNs).toHaveBeenCalledWith('silly', 'Git status')
    })

    it('does not log non-important operations without silly debug', () => {
      mockIsDebugNs.mockReturnValue(false)

      debugGit('status', true)

      expect(debugNs).not.toHaveBeenCalled()
    })
  })
})
