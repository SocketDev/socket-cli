/**
 * @fileoverview Comprehensive tests for HTTP client functionality.
 * Tests module selection, request/response handling, error paths, and edge cases.
 */

import http, { createServer } from 'node:http'
import https from 'node:https'
import { PassThrough } from 'node:stream'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MAX_RESPONSE_SIZE } from '../src/constants.js'
import {
  ResponseError,
  createGetRequest,
  createRequestWithJson,
  getErrorResponseBody,
  getHttpModule,
  getResponseJson,
} from '../src/http-client.js'

import type { IncomingMessage, Server } from 'node:http'

// =============================================================================
// Module Selection Tests
// =============================================================================

describe('HTTP Client - Module Selection', () => {
  describe('getHttpModule', () => {
    it('should return https module for secure HTTPS URLs', () => {
      const httpsModule = getHttpModule('https://api.socket.dev')
      expect(httpsModule).toBe(https)
    })

    it('should return http module for insecure HTTP URLs', () => {
      const httpModule = getHttpModule('http://api.socket.dev')
      expect(httpModule).toBe(http)
    })

    it('should default to http module for non-HTTPS protocol URLs', () => {
      const httpModule = getHttpModule('ftp://example.com')
      expect(httpModule).toBe(http)
    })

    it('should handle edge cases with empty and malformed URLs gracefully', () => {
      expect(getHttpModule('')).toBe(http)
      expect(getHttpModule('not-a-url')).toBe(http)
      expect(getHttpModule('httpss://typo.com')).toBe(http)
    })
  })
})

// =============================================================================
// Response Body Reading Tests
// =============================================================================

describe('HTTP Client - Response Body Reading', () => {
  describe('getErrorResponseBody', () => {
    it('should read normal response body successfully', async () => {
      const mockResponse = new PassThrough() as unknown as IncomingMessage
      const testBody = 'Hello, World!'

      const bodyPromise = getErrorResponseBody(mockResponse)

      // Simulate data chunks
      mockResponse.emit('data', testBody)
      mockResponse.emit('end')

      const result = await bodyPromise
      expect(result).toBe(testBody)
    })

    it('should accumulate multiple chunks correctly', async () => {
      const mockResponse = new PassThrough() as unknown as IncomingMessage
      const chunks = ['Part 1', ' - ', 'Part 2', ' - ', 'Part 3']

      const bodyPromise = getErrorResponseBody(mockResponse)

      // Simulate multiple data chunks
      for (const chunk of chunks) {
        mockResponse.emit('data', chunk)
      }
      mockResponse.emit('end')

      const result = await bodyPromise
      expect(result).toBe(chunks.join(''))
    })

    it('should reject when response exceeds size limit', async () => {
      const mockResponse = new PassThrough() as unknown as IncomingMessage
      mockResponse.destroy = () => {
        // Mock destroy method
        return mockResponse
      }

      // Create a chunk that exceeds the limit
      const largeChunk = 'x'.repeat(MAX_RESPONSE_SIZE + 1)

      const bodyPromise = getErrorResponseBody(mockResponse)

      // Simulate oversized data
      mockResponse.emit('data', largeChunk)

      await expect(bodyPromise).rejects.toThrow(
        'Response exceeds maximum size limit',
      )
    })

    it('should reject when accumulated chunks exceed size limit', async () => {
      const mockResponse = new PassThrough() as unknown as IncomingMessage
      mockResponse.destroy = () => {
        // Mock destroy method
        return mockResponse
      }

      // Create chunks that together exceed the limit
      const chunkSize = Math.floor(MAX_RESPONSE_SIZE / 2) + 1
      const chunk1 = 'a'.repeat(chunkSize)
      const chunk2 = 'b'.repeat(chunkSize)

      const bodyPromise = getErrorResponseBody(mockResponse)

      // First chunk should be fine
      mockResponse.emit('data', chunk1)
      // Second chunk should trigger the limit
      mockResponse.emit('data', chunk2)

      await expect(bodyPromise).rejects.toThrow(
        'Response exceeds maximum size limit',
      )
    })

    it('should handle response at exactly the size limit', async () => {
      const mockResponse = new PassThrough() as unknown as IncomingMessage

      // Create a chunk exactly at the limit
      const exactSizeChunk = 'x'.repeat(MAX_RESPONSE_SIZE)

      const bodyPromise = getErrorResponseBody(mockResponse)

      mockResponse.emit('data', exactSizeChunk)
      mockResponse.emit('end')

      const result = await bodyPromise
      expect(result).toBe(exactSizeChunk)
    })

    it('should correctly handle multi-byte UTF-8 characters in size calculation', async () => {
      const mockResponse = new PassThrough() as unknown as IncomingMessage
      mockResponse.destroy = () => {
        // Mock destroy method
        return mockResponse
      }

      // Create a string with multi-byte characters
      // Each emoji is 4 bytes in UTF-8
      const emojiCount = Math.floor(MAX_RESPONSE_SIZE / 4) + 1
      const largeEmojiString = '😀'.repeat(emojiCount)

      const bodyPromise = getErrorResponseBody(mockResponse)

      mockResponse.emit('data', largeEmojiString)

      await expect(bodyPromise).rejects.toThrow(
        'Response exceeds maximum size limit',
      )
    })
  })
})

// =============================================================================
// Error Handling Tests (with Local Server)
// =============================================================================

describe('HTTP Client - Error Handling', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    // Create a server that can simulate various error conditions
    server = createServer((req, res) => {
      const url = req.url || ''

      if (url.includes('/error-immediate')) {
        // Immediately close connection without response
        req.socket.destroy()
      } else if (url.includes('/invalid-json')) {
        // Return invalid JSON to trigger parsing error
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{ invalid json }')
      } else if (url.includes('/timeout')) {
        // Never respond to trigger timeout
        // (Don't call res.end())
      } else if (url.includes('/json-null-error')) {
        // Return null to trigger JSON.parse error path
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('null')
      } else if (url.includes('/empty-response')) {
        // Return empty response to test empty response handling
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('')
      } else if (url.includes('/non-ok-response')) {
        // Return non-OK response
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not Found' }))
      } else {
        // Default success response
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      }
    })

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          const { port } = address
          baseUrl = `http://127.0.0.1:${port}`
          resolve()
        }
      })
    })
  })

  afterAll(() => {
    server.close()
  })

  describe('createGetRequest error handling', () => {
    it('should handle connection errors', async () => {
      // Try to connect to a port that doesn't exist
      const invalidUrl = 'http://127.0.0.1:1'
      await expect(
        createGetRequest(invalidUrl, '/test', { timeout: 100 }),
      ).rejects.toThrow()
    })

    it('should handle immediate connection close', async () => {
      await expect(
        createGetRequest(baseUrl, '/error-immediate', { timeout: 1000 }),
      ).rejects.toThrow()
    })
  })

  describe('createRequestWithJson error handling', () => {
    it('should handle connection errors', async () => {
      // Try to connect to a port that doesn't exist
      const invalidUrl = 'http://127.0.0.1:1'
      await expect(
        createRequestWithJson(
          'POST',
          invalidUrl,
          '/test',
          {},
          { timeout: 100 },
        ),
      ).rejects.toThrow()
    })

    it('should handle immediate connection close', async () => {
      await expect(
        createRequestWithJson(
          'POST',
          baseUrl,
          '/error-immediate',
          {},
          {
            timeout: 1000,
          },
        ),
      ).rejects.toThrow()
    })
  })

  describe('getResponseJson error handling', () => {
    it('should handle JSON parsing errors', async () => {
      const response = await createGetRequest(baseUrl, '/invalid-json', {
        timeout: 1000,
      })

      await expect(getResponseJson(response)).rejects.toThrow(
        /Invalid JSON response|Expected property name/,
      )
    })

    it('should handle connection errors during JSON read', async () => {
      // Try to connect to invalid URL
      const invalidUrl = 'http://127.0.0.1:1'
      await expect(
        (async () => {
          const response = await createGetRequest(invalidUrl, '/test', {
            timeout: 100,
          })
          return await getResponseJson(response)
        })(),
      ).rejects.toThrow()
    })

    it('should handle empty response as empty object', async () => {
      const response = await createGetRequest(baseUrl, '/empty-response', {
        timeout: 1000,
      })

      const result = await getResponseJson(response)
      expect(result).toEqual({})
    })

    it('should throw ResponseError for non-OK responses with method parameter', async () => {
      const response = await createGetRequest(baseUrl, '/non-ok-response', {
        timeout: 1000,
      })

      await expect(getResponseJson(response, 'GET')).rejects.toThrow(
        'GET Request failed',
      )
    })

    it('should throw ResponseError for non-OK responses without method parameter', async () => {
      const response = await createGetRequest(baseUrl, '/non-ok-response', {
        timeout: 1000,
      })

      await expect(getResponseJson(response)).rejects.toThrow(/Request failed/)
    })
  })

  describe('Error propagation', () => {
    it('should propagate errors through the stack', async () => {
      // This tests that errors are properly caught and re-thrown
      const invalidUrl = 'http://127.0.0.1:1'

      try {
        await createGetRequest(invalidUrl, '/test', { timeout: 100 })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeDefined()
        expect(error instanceof Error).toBe(true)
      }
    })

    it('should handle errors in POST requests', async () => {
      const invalidUrl = 'http://127.0.0.1:1'

      try {
        await createRequestWithJson(
          'POST',
          invalidUrl,
          '/test',
          {},
          {
            timeout: 100,
          },
        )
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeDefined()
        expect(error instanceof Error).toBe(true)
      }
    })

    it('should handle errors in JSON parsing', async () => {
      try {
        const response = await createGetRequest(baseUrl, '/invalid-json', {
          timeout: 1000,
        })
        await getResponseJson(response)
        expect.fail('Should have thrown a JSON parsing error')
      } catch (error) {
        expect(error).toBeDefined()
        expect(error instanceof SyntaxError).toBe(true)
      }
    })
  })
})

// =============================================================================
// ResponseError Edge Cases
// =============================================================================

describe('HTTP Client - ResponseError Edge Cases', () => {
  describe('ResponseError constructor', () => {
    it('should handle empty message parameter', () => {
      const mockResponse = {
        statusCode: 500,
        statusMessage: 'Internal Server Error',
      } as IncomingMessage

      const error = new ResponseError(mockResponse)

      expect(error.message).toContain('Request failed')
      expect(error.message).toContain('500')
      expect(error.message).toContain('Internal Server Error')
      expect(error.name).toBe('ResponseError')
    })

    it('should handle custom message', () => {
      const mockResponse = {
        statusCode: 404,
        statusMessage: 'Not Found',
      } as IncomingMessage

      const error = new ResponseError(mockResponse, 'Custom message')

      expect(error.message).toContain('Custom message')
      expect(error.message).toContain('404')
    })

    it('should handle missing statusCode', () => {
      const mockResponse = {
        statusMessage: 'Error',
      } as IncomingMessage

      const error = new ResponseError(mockResponse)

      expect(error.message).toContain('unknown')
    })

    it('should handle missing statusMessage', () => {
      const mockResponse = {
        statusCode: 500,
      } as IncomingMessage

      const error = new ResponseError(mockResponse)

      expect(error.message).toContain('No status message')
    })

    it('should have response property', () => {
      const mockResponse = {
        statusCode: 500,
        statusMessage: 'Error',
      } as IncomingMessage

      const error = new ResponseError(mockResponse)

      expect(error.response).toBe(mockResponse)
    })

    it('should handle both missing statusCode and statusMessage', () => {
      const mockResponse = {} as IncomingMessage

      const error = new ResponseError(mockResponse)

      expect(error.message).toContain('unknown')
      expect(error.message).toContain('No status message')
    })

    it('should have proper error stack trace', () => {
      const mockResponse = {
        statusCode: 500,
        statusMessage: 'Error',
      } as IncomingMessage

      const error = new ResponseError(mockResponse)

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ResponseError')
    })
  })
})
