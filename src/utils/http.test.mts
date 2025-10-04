import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'

// Mock node:http and node:https modules
const mockRequest = vi.fn()
const mockHttpsRequest = vi.fn()

vi.mock('node:http', () => ({
  default: {
    request: mockRequest,
  },
}))

vi.mock('node:https', () => ({
  default: {
    request: mockHttpsRequest,
  },
}))

import { httpGetJson, httpGetText, httpRequest } from './http.mts'

describe('HTTP utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('httpRequest', () => {
    it('should make a successful HTTP request', async () => {
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'application/json' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('{"test": "data"}'))
          } else if (event === 'end') {
            callback()
          }
        }),
      } as unknown as IncomingMessage

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse)
        return {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      const result = await httpRequest('http://example.com/api')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe(200)
        expect(result.data.ok).toBe(true)
        expect(result.data.text()).toBe('{"test": "data"}')
      }
    })

    it('should handle HTTP errors', async () => {
      const mockResponse = {
        statusCode: 404,
        statusMessage: 'Not Found',
        headers: {},
        on: vi.fn((event, callback) => {
          if (event === 'end') {
            callback()
          }
        }),
      } as unknown as IncomingMessage

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse)
        return {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      const result = await httpRequest('http://example.com/notfound')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.status).toBe(404)
        expect(result.data.ok).toBe(false)
      }
    })

    it('should use HTTPS for https:// URLs', async () => {
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        on: vi.fn((event, callback) => {
          if (event === 'end') {
            callback()
          }
        }),
      } as unknown as IncomingMessage

      mockHttpsRequest.mockImplementation((options, callback) => {
        callback(mockResponse)
        return {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      await httpRequest('https://secure.example.com/api')

      expect(mockHttpsRequest).toHaveBeenCalled()
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('should handle network errors', async () => {
      mockRequest.mockImplementation(() => {
        return {
          on: vi.fn((event, callback) => {
            if (event === 'error') {
              callback(new Error('Network error'))
            }
          }),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      const result = await httpRequest('http://example.com/error')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Network error')
      }
    })

    it('should handle request timeout', async () => {
      mockRequest.mockImplementation(() => {
        return {
          on: vi.fn((event, callback) => {
            if (event === 'timeout') {
              callback()
            }
          }),
          write: vi.fn(),
          end: vi.fn(),
          destroy: vi.fn(),
        }
      })

      const result = await httpRequest('http://example.com/slow', {
        timeout: 100,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('timeout')
      }
    })
  })

  describe('httpGetJson', () => {
    it('should parse JSON response', async () => {
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('{"name": "test", "value": 42}'))
          } else if (event === 'end') {
            callback()
          }
        }),
      } as unknown as IncomingMessage

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse)
        return {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      const result = await httpGetJson<{ name: string; value: number }>(
        'http://example.com/data.json',
      )

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.name).toBe('test')
        expect(result.data.value).toBe(42)
      }
    })

    it('should handle invalid JSON', async () => {
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('not valid json'))
          } else if (event === 'end') {
            callback()
          }
        }),
      } as unknown as IncomingMessage

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse)
        return {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      const result = await httpGetJson('http://example.com/invalid')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('JSON')
      }
    })
  })

  describe('httpGetText', () => {
    it('should return text response', async () => {
      const mockResponse = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('Hello, World!'))
          } else if (event === 'end') {
            callback()
          }
        }),
      } as unknown as IncomingMessage

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse)
        return {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        }
      })

      const result = await httpGetText('http://example.com/text')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('Hello, World!')
      }
    })
  })
})
