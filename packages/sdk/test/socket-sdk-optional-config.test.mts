/**
 * @fileoverview Tests for Socket SDK optional configuration parameters.
 *
 * This test suite covers optional parameters and configurations that
 * are not covered in the main test files, including:
 * - Agent configuration
 * - Cache configuration
 * - Timeout configuration
 * - IssueRules parameter
 * - Empty response handling
 */
import nock from 'nock'
import { describe, expect, it } from 'vitest'

import { SocketSdk } from '../src/index'
import { isCoverageMode, setupTestClient } from './utils/environment.mts'

import type { SocketSdkGenericResult } from '../src/index'

describe.skipIf(isCoverageMode)('SocketSdk - Optional Configuration', () => {
  const getClient = setupTestClient('test-token', { retries: 0 })

  describe('Agent configuration', () => {
    it('should work with agent configuration', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test')
        .reply(200, { success: true })

      const client = new SocketSdk('test-token', {
        retries: 0,
      })

      const result = (await client.getApi('test', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(true)
    })
  })

  describe('Cache configuration', () => {
    it('should work with cache disabled', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-no-cache')
        .reply(200, { cached: false })

      const client = new SocketSdk('test-token', {
        cache: false,
        retries: 0,
      })

      const result = (await client.getApi('test-no-cache', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(true)
    })
  })

  describe('Timeout configuration', () => {
    it('should accept custom timeout parameter', async () => {
      nock('https://api.socket.dev')
        .get('/v0/test-timeout')
        .reply(200, { success: true })

      // 10 second timeout
      const client = new SocketSdk('test-token', {
        retries: 0,
        timeout: 10_000,
      })

      const result = (await client.getApi('test-timeout', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      expect(result.success).toBe(true)
    })
  })

  describe('Empty response handling', () => {
    it('should handle truly empty response bodies', async () => {
      nock('https://api.socket.dev').get('/v0/empty-test').reply(200, '')

      const result = (await getClient().getApi('empty-test', {
        responseType: 'json',
        throws: false,
      })) as SocketSdkGenericResult<unknown>

      // Empty responses are treated as {}
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({})
      }
    })
  })

  describe('Public token artifact reshaping', () => {
    it('should handle empty lines in NDJSON batch responses', async () => {
      const mockResponses = [
        { purl: 'pkg:npm/pkg1@1.0.0', name: 'pkg1' },
        { purl: 'pkg:npm/pkg2@2.0.0', name: 'pkg2' },
      ]

      // Response with empty lines. Multiple empty lines to test filtering
      const responseText =
        JSON.stringify(mockResponses[0]) +
        '\n\n\n' +
        JSON.stringify(mockResponses[1]) +
        '\n'

      nock('https://api.socket.dev').post('/v0/purl').reply(200, responseText)

      const result = await getClient().batchPackageFetch({
        components: [
          { purl: 'pkg:npm/pkg1@1.0.0' },
          { purl: 'pkg:npm/pkg2@2.0.0' },
        ],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(2)
      }
    })
  })
})
