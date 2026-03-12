/**
 * Unit tests for Update checker utilities.
 *
 * Purpose:
 * Tests the update checking functionality for Socket CLI.
 *
 * Test Coverage:
 * - isUpdateAvailable function
 * - checkForUpdates function
 * - NetworkUtils.fetch function
 * - NetworkUtils.getLatestVersion function
 * - Error handling and retries
 *
 * Related Files:
 * - utils/update/checker.mts (implementation)
 */

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock https module.
const mockRequest = vi.hoisted(() => vi.fn())
vi.mock('node:https', () => ({
  default: {
    request: mockRequest,
  },
  request: mockRequest,
}))

// Mock signal-exit.
vi.mock('@socketsecurity/lib/signal-exit', () => ({
  onExit: vi.fn(() => () => {}),
}))

// Mock logger.
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
  }),
}))

import {
  checkForUpdates,
  isUpdateAvailable,
  NetworkUtils,
} from '../../../../src/utils/update/checker.mts'

// Helper types.
interface MockResponse extends EventEmitter {
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
}

interface MockRequest extends EventEmitter {
  destroy: () => void
  end: () => void
}

// Helper to create mock response.
function createMockResponse(
  statusCode: number,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): MockResponse {
  const res = new EventEmitter() as MockResponse
  res.statusCode = statusCode
  res.statusMessage = statusCode === 200 ? 'OK' : 'Error'
  res.headers = headers
  return res
}

// Helper to create mock request.
function createMockRequest(): MockRequest {
  const req = new EventEmitter() as MockRequest
  req.destroy = vi.fn()
  req.end = vi.fn()
  return req
}

describe('update/checker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('isUpdateAvailable', () => {
    it('returns true when latest is greater than current', () => {
      expect(isUpdateAvailable('1.0.0', '2.0.0')).toBe(true)
    })

    it('returns true when latest is a minor update', () => {
      expect(isUpdateAvailable('1.0.0', '1.1.0')).toBe(true)
    })

    it('returns true when latest is a patch update', () => {
      expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true)
    })

    it('returns false when versions are equal', () => {
      expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false)
    })

    it('returns false when current is greater than latest', () => {
      expect(isUpdateAvailable('2.0.0', '1.0.0')).toBe(false)
    })

    it('handles versions with v prefix', () => {
      expect(isUpdateAvailable('v1.0.0', 'v2.0.0')).toBe(true)
    })

    it('handles prerelease versions', () => {
      expect(isUpdateAvailable('1.0.0-beta.1', '1.0.0')).toBe(true)
    })

    it('falls back to string comparison for invalid versions', () => {
      expect(isUpdateAvailable('invalid', 'invalid')).toBe(false)
      expect(isUpdateAvailable('invalid', 'different')).toBe(true)
    })
  })

  describe('NetworkUtils.fetch', () => {
    it('throws error for empty URL', async () => {
      await expect(NetworkUtils.fetch('')).rejects.toThrow(
        'Invalid URL provided to fetch',
      )
    })

    it('fetches data successfully', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '1.2.3' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      const result = await NetworkUtils.fetch('https://registry.npmjs.org/test')

      expect(result).toEqual({ version: '1.2.3' })
      expect(mockReq.end).toHaveBeenCalled()
    })

    it('includes authorization header when authInfo provided', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '1.0.0' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await NetworkUtils.fetch('https://registry.npmjs.org/test', {
        authInfo: { token: 'test-token', type: 'Bearer' },
      })

      const callOptions = mockRequest.mock.calls[0]?.[0]
      expect(callOptions.headers.Authorization).toBe('Bearer test-token')
    })

    it('rejects on HTTP error status', async () => {
      const mockRes = createMockResponse(404)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ error: 'Not found' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await expect(
        NetworkUtils.fetch('https://registry.npmjs.org/nonexistent'),
      ).rejects.toThrow('HTTP 404')
    })

    it('rejects on invalid JSON response', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', 'not valid json')
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await expect(
        NetworkUtils.fetch('https://registry.npmjs.org/test'),
      ).rejects.toThrow('Failed to parse JSON response')
    })

    it('rejects on network error', async () => {
      const mockReq = createMockRequest()

      mockRequest.mockImplementation(() => {
        process.nextTick(() =>
          mockReq.emit('error', new Error('Connection refused')),
        )
        return mockReq
      })

      await expect(
        NetworkUtils.fetch('https://registry.npmjs.org/test'),
      ).rejects.toThrow('Network request failed: Connection refused')
    })

    it('rejects on timeout', async () => {
      const mockReq = createMockRequest()

      mockRequest.mockImplementation(() => {
        process.nextTick(() => mockReq.emit('timeout'))
        return mockReq
      })

      await expect(
        NetworkUtils.fetch('https://registry.npmjs.org/test', {}, 1000),
      ).rejects.toThrow('Request timed out after 1000ms')

      expect(mockReq.destroy).toHaveBeenCalled()
    })

    it('rejects when JSON response is not an object', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', '"just a string"')
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await expect(
        NetworkUtils.fetch('https://registry.npmjs.org/test'),
      ).rejects.toThrow('Invalid JSON response from registry')
    })
  })

  describe('NetworkUtils.getLatestVersion', () => {
    it('throws error for empty package name', async () => {
      await expect(NetworkUtils.getLatestVersion('')).rejects.toThrow(
        'Package name must be a non-empty string',
      )
    })

    it('throws error for invalid registry URL', async () => {
      await expect(
        NetworkUtils.getLatestVersion('test', { registryUrl: 'not-a-url' }),
      ).rejects.toThrow('Invalid registry URL: not-a-url')
    })

    it('returns latest version on success', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '2.0.0' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      const result = await NetworkUtils.getLatestVersion('test-package')

      expect(result).toBe('2.0.0')
    })

    it('uses custom registry URL', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '1.0.0' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await NetworkUtils.getLatestVersion('test', {
        registryUrl: 'https://custom.registry.com',
      })

      const callOptions = mockRequest.mock.calls[0]?.[0]
      expect(callOptions.hostname).toBe('custom.registry.com')
    })

    it('throws error when version is missing from response', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ name: 'test' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await expect(
        NetworkUtils.getLatestVersion('test-package'),
      ).rejects.toThrow('Invalid version data in registry response')
    })
  })

  describe('checkForUpdates', () => {
    it('throws error for empty package name', async () => {
      await expect(
        checkForUpdates({ name: '', version: '1.0.0' }),
      ).rejects.toThrow('Package name must be a non-empty string')
    })

    it('throws error for empty version', async () => {
      await expect(
        checkForUpdates({ name: 'test', version: '' }),
      ).rejects.toThrow('Current version must be a non-empty string')
    })

    it('returns update check result when update is available', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '2.0.0' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
      })

      expect(result).toEqual({
        current: '1.0.0',
        latest: '2.0.0',
        updateAvailable: true,
      })
    })

    it('returns update check result when no update is available', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '1.0.0' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      const result = await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
      })

      expect(result).toEqual({
        current: '1.0.0',
        latest: '1.0.0',
        updateAvailable: false,
      })
    })

    it('passes authInfo to network request', async () => {
      const mockRes = createMockResponse(200)
      const mockReq = createMockRequest()

      mockRequest.mockImplementation((_options, callback) => {
        process.nextTick(() => {
          callback(mockRes)
          process.nextTick(() => {
            mockRes.emit('data', JSON.stringify({ version: '1.0.0' }))
            mockRes.emit('end')
          })
        })
        return mockReq
      })

      await checkForUpdates({
        name: 'test-package',
        version: '1.0.0',
        authInfo: { token: 'test-token', type: 'Bearer' },
      })

      const callOptions = mockRequest.mock.calls[0]?.[0]
      expect(callOptions.headers.Authorization).toBe('Bearer test-token')
    })

    it('throws error when registry fetch fails', async () => {
      const mockReq = createMockRequest()

      mockRequest.mockImplementation(() => {
        process.nextTick(() =>
          mockReq.emit('error', new Error('Network error')),
        )
        return mockReq
      })

      await expect(
        checkForUpdates({ name: 'test-package', version: '1.0.0' }),
      ).rejects.toThrow()
    })
  })
})
