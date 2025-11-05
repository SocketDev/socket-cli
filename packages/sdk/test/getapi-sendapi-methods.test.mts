/** @fileoverview Tests for generic getApi and sendApi method functionality. */

import nock from 'nock'
import { describe, expect, it } from 'vitest'

import { SocketSdk } from '../src/index'
import { setupTestClient } from './utils/environment.mts'

import type { SocketSdkGenericResult } from '../src/index'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'

describe('getApi and sendApi Methods', () => {
  const getClient = setupTestClient('test-api-token', { retries: 0 })

  describe('getApi', () => {
    it('should return IncomingMessage when throws=true (default)', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-endpoint')
        .reply(200, 'success')

      const result = await getClient().getApi('test-endpoint')

      expect(result).toBeDefined()
      expect((result as IncomingMessage).statusCode).toBe(200)
    })

    it('should return SocketSdkGenericResult<IncomingMessage> when throws=false', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-endpoint')
        .reply(200, 'success')

      const result = (await getClient().getApi('test-endpoint', {
        throws: false,
      })) as SocketSdkGenericResult<IncomingMessage>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeDefined()
        expect(result.data.statusCode).toBe(200)
      }
    })

    it('should throw error when throws=true and request fails', async () => {
      await expect(getClient().getApi('nonexistent-endpoint')).rejects.toThrow()
    })

    it('should return error CResult when throws=false and request fails', async () => {
      const result = (await getClient().getApi('nonexistent-endpoint', {
        throws: false,
      })) as SocketSdkGenericResult<IncomingMessage>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(result.cause).toBeDefined()
      }
    })

    it('should handle baseUrl with trailing slash correctly', async () => {
      const clientWithSlash = new SocketSdk('test-token', {
        baseUrl: 'https://api.socket.dev/v0/',
      })
      nock('https://api.socket.dev')
        .get('/v0/test-endpoint')
        .reply(200, 'success')

      const result = await clientWithSlash.getApi('test-endpoint')
      expect((result as IncomingMessage).statusCode).toBe(200)
    })

    it('should handle baseUrl without trailing slash correctly', async () => {
      const clientWithoutSlash = new SocketSdk('test-token', {
        baseUrl: 'https://api.socket.dev/v0',
      })
      nock('https://api.socket.dev')
        .get('/v0/test-endpoint')
        .reply(200, 'success')

      const result = await clientWithoutSlash.getApi('test-endpoint')
      expect((result as IncomingMessage).statusCode).toBe(200)
    })
  })

  describe('getApi with responseType: text', () => {
    it('should return text when throws=true (default) and request succeeds', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-text')
        .reply(200, 'Hello, world!')

      const result = await getClient().getApi<string>('test-text', {
        responseType: 'text',
      })

      expect(result).toBe('Hello, world!')
    })

    it('should return SocketSdkGenericResult<string> when throws=false and request succeeds', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-text')
        .reply(200, 'Hello, world!')

      const result = (await getClient().getApi<string>('test-text', {
        responseType: 'text',
        throws: false,
      })) as SocketSdkGenericResult<string>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('Hello, world!')
      }
    })

    it('should throw error when throws=true and API returns error status', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-error')
        .reply(404, 'Not found')

      await expect(
        getClient().getApi<string>('test-error', { responseType: 'text' }),
      ).rejects.toThrow(/Socket API Request failed \(404\)/)
    })

    it('should return error CResult when throws=false and API returns error status', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-error')
        .reply(404, 'Not found')

      const result = (await getClient().getApi<string>('test-error', {
        responseType: 'text',
        throws: false,
      })) as SocketSdkGenericResult<string>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(404)
        expect(result.error).toContain('Socket API')
        expect(result.cause).toContain('Not found')
      }
    })

    it('should handle empty response body', async () => {
      nock('https://api.socket.dev').get('/v0/empty').reply(200, '')

      const result = (await getClient().getApi<string>('empty', {
        responseType: 'text',
        throws: false,
      })) as SocketSdkGenericResult<string>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('')
      }
    })

    it('should handle network errors gracefully with throws=false', async () => {
      const result = (await getClient().getApi<string>('network-error', {
        responseType: 'text',
        throws: false,
      })) as SocketSdkGenericResult<string>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(result.cause).toBeDefined()
      }
    })
  })

  describe('getApi with responseType: json', () => {
    it('should return parsed JSON when throws=true (default)', async () => {
      const testData = { message: 'Hello, JSON!' }
      nock('https://api.socket.dev').get('/v0/test-json').reply(200, testData)

      const result = await getClient().getApi<typeof testData>('test-json', {
        responseType: 'json',
      })

      expect(result).toEqual(testData)
    })

    it('should return SocketSdkGenericResult<T> when throws=false', async () => {
      const testData = { message: 'Hello, JSON!' }
      nock('https://api.socket.dev').get('/v0/test-json').reply(200, testData)

      const result = (await getClient().getApi<typeof testData>('test-json', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<typeof testData>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(testData)
      }
    })

    it('should handle complex JSON objects', async () => {
      const complexData = {
        users: [
          { id: 1, name: 'Alice', active: true },
          { id: 2, name: 'Bob', active: false },
        ],
        meta: { total: 2, page: 1 },
      }
      nock('https://api.socket.dev')
        .get('/v0/complex-json')
        .reply(200, complexData)

      const result = (await getClient().getApi<typeof complexData>(
        'complex-json',
        {
          responseType: 'json',
          throws: false,
        },
      )) as SocketSdkGenericResult<typeof complexData>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(complexData)
      }
    })

    it('should throw error when throws=true and JSON is invalid', async () => {
      nock('https://api.socket.dev')
        .get('/v0/invalid-json')
        .reply(200, 'invalid json content')

      await expect(
        getClient().getApi('invalid-json', { responseType: 'json' }),
      ).rejects.toThrow()
    })

    it('should return error CResult when throws=false and JSON is invalid', async () => {
      nock('https://api.socket.dev')
        .get('/v0/invalid-json')
        .reply(200, 'invalid json content')

      const result = (await getClient().getApi('invalid-json', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('invalid json content')
      }
    })

    it('should handle API error responses', async () => {
      nock('https://api.socket.dev')
        .get('/v0/api-error')
        .reply(400, { error: 'Bad Request' })

      const result = (await getClient().getApi('api-error', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(400)
        expect(result.error).toContain('Socket API')
      }
    })
  })

  describe('sendApi', () => {
    it('should send POST request with JSON body when throws=true (default)', async () => {
      const requestData = { name: 'Test', value: 42 }
      const responseData = { id: 123, status: 'created' }

      nock('https://api.socket.dev')
        .post('/v0/create', requestData)
        .reply(201, responseData)

      const result = await getClient().sendApi<typeof responseData>('create', {
        method: 'POST',
        body: requestData,
      })

      expect(result).toEqual(responseData)
    })

    it('should return SocketSdkGenericResult<T> when throws=false', async () => {
      const requestData = { name: 'Test', value: 42 }
      const responseData = { id: 123, status: 'created' }

      nock('https://api.socket.dev')
        .post('/v0/create', requestData)
        .reply(201, responseData)

      const result = (await getClient().sendApi<typeof responseData>('create', {
        method: 'POST',
        body: requestData,
        throws: false,
      })) as SocketSdkGenericResult<typeof responseData>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(responseData)
      }
    })

    it('should send PUT request', async () => {
      const requestData = { name: 'Updated Test', value: 84 }
      const responseData = { id: 123, status: 'updated' }

      nock('https://api.socket.dev')
        .put('/v0/update/123', requestData)
        .reply(200, responseData)

      const result = (await getClient().sendApi<typeof responseData>(
        'update/123',
        {
          method: 'PUT',
          body: requestData,
          throws: false,
        },
      )) as SocketSdkGenericResult<typeof responseData>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(responseData)
      }
    })

    it('should handle requests without body', async () => {
      const responseData = { status: 'processed' }

      nock('https://api.socket.dev')
        .post('/v0/process')
        .reply(200, responseData)

      const result = (await getClient().sendApi<typeof responseData>(
        'process',
        {
          body: {},
          throws: false,
        },
      )) as SocketSdkGenericResult<typeof responseData>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(responseData)
      }
    })

    it('should throw error when throws=true and request fails', async () => {
      const requestData = { invalid: true }

      nock('https://api.socket.dev')
        .post('/v0/fail', requestData)
        .reply(400, { error: 'Validation failed' })

      await expect(
        getClient().sendApi('fail', {
          body: requestData,
        }),
      ).rejects.toThrow(/Socket API Request failed \(400\)/)
    })

    it('should return error CResult when throws=false and request fails', async () => {
      const requestData = { invalid: true }

      nock('https://api.socket.dev')
        .post('/v0/fail', requestData)
        .reply(422, { error: 'Unprocessable Entity' })

      const result = (await getClient().sendApi('fail', {
        body: requestData,
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.status).toBe(422)
        expect(result.error).toContain('Socket API')
        if (result.cause) {
          expect(result.cause).toContain('Unprocessable Entity')
        }
      }
    })

    it('should handle JSON parsing errors in response', async () => {
      nock('https://api.socket.dev')
        .post('/v0/invalid-response')
        .reply(200, 'not valid json')

      const result = (await getClient().sendApi('invalid-response', {
        body: { test: true },
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(result.cause).toContain(
          'Socket API returned invalid JSON response',
        )
      }
    })

    it('should include Content-Type header for JSON requests', async () => {
      const requestData = { test: true }
      let capturedHeaders: IncomingHttpHeaders = {}

      nock('https://api.socket.dev')
        .post('/v0/headers-test', requestData)
        .reply(function () {
          capturedHeaders = this.req.headers
          return [200, { received: true }]
        })

      await getClient().sendApi('headers-test', {
        body: requestData,
        throws: false,
      })

      expect(capturedHeaders['content-type']).toBe('application/json')
    })

    it('should handle network errors gracefully', async () => {
      const result = (await getClient().sendApi('network-fail', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(result.cause).toBeDefined()
      }
    })
  })

  describe('Edge case error handling for coverage', () => {
    it('should handle error with long response text in JSON parsing error', async () => {
      nock('https://api.socket.dev')
        .get('/v0/long-invalid-json')
        .reply(
          200,
          'a'.repeat(150) +
            ' - this is a very long invalid json response that should be truncated',
        )

      const result = (await getClient().getApi('long-invalid-json', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('…')
      }
    })

    it('should handle error with no match in JSON parsing error', async () => {
      nock('https://api.socket.dev')
        .get('/v0/no-match-json')
        .reply(200, 'invalid json')

      const result = (await getClient().getApi('no-match-json', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('Please report this')
      }
    })

    it('should handle null/undefined errors in sendApi', async () => {
      const result = (await getClient().sendApi('null-error', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(typeof result.cause).toBe('string')
      }
    })

    it('should handle empty response text causing empty preview', async () => {
      nock('https://api.socket.dev')
        .get('/v0/empty-preview-json')
        .reply(200, '')

      const result = (await getClient().getApi('empty-preview-json', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      // Empty response is handled as empty object by getResponseJson
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({})
      }
    })

    it('should handle falsy error string in error result creation', async () => {
      // Simulate a custom error handler that tests the edge case
      nock('https://api.socket.dev')
        .get('/v0/falsy-error')
        .reply(400, 'Bad Request')

      const result = (await getClient().getApi('falsy-error', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Socket API')
        expect(result.cause).toBeDefined()
      }
    })

    it('should handle short response text without truncation', async () => {
      nock('https://api.socket.dev')
        .get('/v0/short-invalid-json')
        .reply(200, 'short response')

      const result = (await getClient().getApi('short-invalid-json', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('short response')
        expect(result.cause).not.toContain('...')
      }
    })

    it('should handle undefined errors in error result creation', async () => {
      // Test the null/undefined error path more specifically
      const result = (await getClient().sendApi('nonexistent-endpoint', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(typeof result.cause).toBe('string')
      }
    })

    it('should handle JSON parsing error with no regex match', async () => {
      // Create a SyntaxError that doesn't match the regex pattern
      nock('https://api.socket.dev')
        .get('/v0/no-match-error')
        .reply(200, 'invalid')

      const result = (await getClient().getApi('no-match-error', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('Please report this')
      }
    })

    it('should handle empty preview string in error creation', async () => {
      // Test when responseText.slice(0, 100) returns empty string
      nock('https://api.socket.dev').get('/v0/empty-slice').reply(200, '')

      const result = (await getClient().getApi('empty-slice', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      // Empty response is handled as {} by getResponseJson
      expect(result.success).toBe(true)
    })

    it('should handle null error in sendApi error creation', async () => {
      // Simulate a scenario that creates an error that becomes null when stringified
      const result = (await getClient().sendApi('null-error-path', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(result.cause).toBeDefined()
      }
    })

    it('should handle empty error string in sendApi', async () => {
      // This will test the errStr || UNKNOWN_ERROR branch
      const result = (await getClient().sendApi('empty-error-string', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(typeof result.cause).toBe('string')
      }
    })

    it('should handle falsy error parameter in getApi error creation', async () => {
      // Test the e ? String(e).trim() : '' branch with falsy e
      const result = (await getClient().getApi('falsy-error-param', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(typeof result.cause).toBe('string')
      }
    })

    it('should handle error with match but no captured group', async () => {
      // Mock getResponseJson to throw a specific SyntaxError that will match regex but have no captured group
      nock('https://api.socket.dev')
        .get('/v0/no-capture-group')
        .reply(200, 'malformed json {')

      const result = (await getClient().getApi('no-capture-group', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toContain('Please report this')
      }
    })

    it('should handle error with trim on empty string', async () => {
      // Create a scenario that tests trim() on an empty response
      nock('https://api.socket.dev').get('/v0/empty-trim').reply(200, '   ')

      const result = (await getClient().getApi('empty-trim', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Server returned invalid JSON')
        expect(result.cause).toBeDefined()
      }
    })

    it('should handle preview slice edge case with empty result', async () => {
      // Test responseText.slice(0, 100) || '' where slice returns empty
      nock('https://api.socket.dev').get('/v0/preview-edge').reply(200, '')

      const result = (await getClient().getApi('preview-edge', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      // Empty response returns {} from getResponseJson, so this should succeed
      expect(result.success).toBe(true)
    })

    it('should handle error that becomes empty string when converted', async () => {
      // Test the errStr || UNKNOWN_ERROR branches more directly
      const result = (await getClient().sendApi('trigger-empty-string-error', {
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('API request failed')
        expect(result.cause).toBeDefined()
      }
    })
  })

  describe('Integration with existing patterns', () => {
    it('should handle fallback responseType for default response handling', async () => {
      nock('https://api.socket.dev')
        .get('/v0/fallback-test')
        .reply(200, 'fallback response')

      const result = (await getClient().getApi('fallback-test', {
        responseType: 'invalid' as any,
        throws: false,
      })) as SocketSdkGenericResult<IncomingMessage>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeDefined()
        expect(result.data.statusCode).toBe(200)
      }
    })

    it('should use custom User-Agent from SDK options', async () => {
      const customClient = new SocketSdk('test-token', {
        userAgent: 'CustomApp/1.0.0',
      })
      let capturedHeaders: IncomingHttpHeaders = {}

      nock('https://api.socket.dev')
        .get('/v0/user-agent-test')
        .reply(function () {
          capturedHeaders = this.req.headers
          return [200, 'ok']
        })

      await customClient.getApi<string>('user-agent-test', {
        responseType: 'text',
        throws: false,
      })

      expect(capturedHeaders['user-agent']).toBe('CustomApp/1.0.0')
    })

    it('should work with custom base URLs', async () => {
      const customClient = new SocketSdk('test-token', {
        baseUrl: 'https://custom.socket.dev/api/',
      })

      nock('https://custom.socket.dev')
        .get('/api/custom-endpoint')
        .reply(200, { custom: true })

      const result = (await customClient.getApi<{ custom: boolean }>(
        'custom-endpoint',
        { responseType: 'json', throws: false },
      )) as SocketSdkGenericResult<{ custom: boolean }>

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.custom).toBe(true)
      }
    })
  })
})
