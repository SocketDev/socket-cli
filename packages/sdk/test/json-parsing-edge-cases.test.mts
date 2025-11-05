/** @fileoverview Tests for JSON parsing edge cases in HTTP client. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IncomingMessage } from 'node:http'

// Mock the registry module to control JSON parsing behavior.
vi.mock('@socketsecurity/lib/json', () => ({
  jsonParse: vi.fn(),
}))

// Use dynamic imports to ensure mocks are applied.
const { getResponseJson } = await import('../src/http-client.js')
const { jsonParse } = await import('@socketsecurity/lib/json')
const mockJsonParse = vi.mocked(jsonParse)

describe('JSON Parsing Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getResponseJson error handling', () => {
    it('should handle non-Error objects thrown during JSON parsing', async () => {
      // Create a mock response with 200 status.
      const mockResponse = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn(),
        headers: {
          'content-type': 'application/json',
        },
      } as unknown as IncomingMessage

      // Mock response.on to simulate receiving data.
      const responseBody = '{"test": "data"}'

      // Setup the mock to call the data and end handlers.
      mockResponse.on = vi.fn((event: string, handler: any) => {
        if (event === 'data') {
          // Simulate receiving data.
          setTimeout(() => handler(responseBody), 0)
        } else if (event === 'end') {
          // Simulate end of data.
          setTimeout(() => handler(), 0)
        }
        return mockResponse
      })

      // Force jsonParse to throw a non-Error, non-SyntaxError object.
      mockJsonParse.mockImplementation(() => {
        throw 'This is a string error, not an Error instance'
      })

      await expect(getResponseJson(mockResponse)).rejects.toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: 'Unknown JSON parsing error',
          originalResponse: responseBody,
        }),
      )

      expect(mockJsonParse).toHaveBeenCalledWith(responseBody)
    })

    it('should re-throw Error instances without modification', async () => {
      // Create a mock response with 200 status.
      const mockResponse = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn(),
        headers: {
          'content-type': 'application/json',
        },
      } as unknown as IncomingMessage

      const responseBody = '{"test": "data"}'

      // Setup the mock to call the data and end handlers.
      mockResponse.on = vi.fn((event: string, handler: any) => {
        if (event === 'data') {
          setTimeout(() => handler(responseBody), 0)
        } else if (event === 'end') {
          setTimeout(() => handler(), 0)
        }
        return mockResponse
      })

      // Force jsonParse to throw a regular Error (not SyntaxError).
      const customError = new Error('Custom parsing error')
      mockJsonParse.mockImplementation(() => {
        throw customError
      })

      await expect(getResponseJson(mockResponse)).rejects.toThrow(customError)
      expect(mockJsonParse).toHaveBeenCalledWith(responseBody)
    })

    it('should handle SyntaxError with enhanced error message', async () => {
      // Create a mock response with 200 status.
      const mockResponse = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn(),
        headers: {
          'content-type': 'application/json',
        },
      } as unknown as IncomingMessage

      const responseBody = 'invalid json {'

      // Setup the mock to call the data and end handlers.
      mockResponse.on = vi.fn((event: string, handler: any) => {
        if (event === 'data') {
          setTimeout(() => handler(responseBody), 0)
        } else if (event === 'end') {
          setTimeout(() => handler(), 0)
        }
        return mockResponse
      })

      // Force jsonParse to throw a SyntaxError.
      const syntaxError = new SyntaxError('Unexpected end of JSON input')
      mockJsonParse.mockImplementation(() => {
        throw syntaxError
      })

      await expect(getResponseJson(mockResponse)).rejects.toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining(
            'Socket API returned invalid JSON response',
          ),
          originalResponse: responseBody,
        }),
      )

      expect(mockJsonParse).toHaveBeenCalledWith(responseBody)
    })
  })
})
