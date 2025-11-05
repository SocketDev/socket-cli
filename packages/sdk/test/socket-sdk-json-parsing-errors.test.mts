/** @fileoverview Tests for JSON parsing and syntax error handling in HTTP client. */
import nock from 'nock'
import { describe, expect, it } from 'vitest'

import { isCoverageMode, setupTestClient } from './utils/environment.mts'

import type { SocketSdkGenericResult } from '../src/index'

describe('SocketSdk - Branch Coverage Tests', () => {
  const getClient = setupTestClient('test-api-token', { retries: 0 })

  describe('SyntaxError handling branches', () => {
    it('should handle SyntaxError without originalResponse property', async () => {
      // Force a SyntaxError by returning invalid JSON
      nock('https://api.socket.dev')
        .get('/v0/syntax-error-test')
        .reply(200, '{invalid json}')

      const result = (await getClient().getApi('syntax-error-test', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('JSON.parse threw an error')
      }
    })

    it.skipIf(isCoverageMode)(
      'should handle empty responseText slice branch',
      async () => {
        // Create a scenario where responseText would be empty after slicing
        nock('https://api.socket.dev')
          .get('/v0/empty-response-test')
          .reply(200, '')

        const result = (await getClient().getApi('empty-response-test', {
          responseType: 'json',
          throws: false,
        })) as SocketSdkGenericResult<unknown>

        // Empty response should actually parse as {} and succeed
        expect(result.success).toBe(true)
      },
    )
  })

  describe('API error handling branches', () => {
    it.skipIf(isCoverageMode)(
      'should handle ResponseError in getApi with throws: false',
      async () => {
        // Mock a ResponseError (HTTP error response) for getApi
        nock('https://api.socket.dev')
          .get('/v0/getapi-error-test')
          .reply(404, { error: 'Not Found', message: 'Resource not found' })

        const result = (await getClient().getApi('getapi-error-test', {
          responseType: 'json',
          throws: false,
        })) as SocketSdkGenericResult<unknown>

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.status).toBe(404)
        }
      },
    )

    it.skipIf(isCoverageMode)(
      'should handle ResponseError in sendApi with throws: false',
      async () => {
        // Mock a ResponseError (HTTP error response)
        nock('https://api.socket.dev')
          .post('/v0/response-error-test')
          .reply(400, { error: 'Bad Request', message: 'Invalid data' })

        const result = (await getClient().sendApi('response-error-test', {
          throws: false,
          method: 'POST',
          body: { test: 'data' },
        })) as SocketSdkGenericResult<unknown>

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.status).toBe(400)
        }
      },
    )
  })

  describe('Edge cases for complete branch coverage', () => {
    it('should handle SyntaxError with regex match but no capture group', async () => {
      // Create a SyntaxError scenario that matches the regex pattern but has no capture
      const customError = new SyntaxError(
        'Invalid JSON response:\n\n→',
      ) as SyntaxError & { originalResponse?: string | undefined }
      customError.originalResponse = undefined

      nock('https://api.socket.dev')
        .get('/v0/regex-no-capture')
        .reply(200, 'Invalid JSON response:\n\n→')

      const result = (await getClient().getApi('regex-no-capture', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
    })

    it('should detect 502 Bad Gateway in response body', async () => {
      nock('https://api.socket.dev')
        .get('/v0/502-test')
        .reply(200, '502 Bad Gateway')

      const result = (await getClient().getApi('502-test', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('invalid JSON')
        expect(result.cause).toContain('502 Bad Gateway')
      }
    })

    it('should detect 503 Service in response body', async () => {
      nock('https://api.socket.dev')
        .get('/v0/503-test')
        .reply(200, '503 Service Unavailable')

      const result = (await getClient().getApi('503-test', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('invalid JSON')
        expect(result.cause).toContain('503 Service')
      }
    })
  })
})
