/**
 * Unit tests for Socket SDK setup.
 *
 * Purpose:
 * Tests Socket SDK initialization and configuration. Validates SDK setup with various options.
 *
 * Test Coverage:
 * - SDK initialization
 * - API token handling
 * - Base URL configuration
 * - User agent setup
 * - SDK error handling
 *
 * Testing Approach:
 * Mocks @socketsecurity/sdk to test setup logic.
 *
 * Related Files:
 * - utils/socket/sdk.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import http from 'node:http'

import { SocketSdk } from '@socketsecurity/sdk'

import {
  getPublicApiToken,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
} from '../../../../src/utils/socket/sdk.mts'

describe('SDK Utilities', () => {
  describe('getPublicApiToken', () => {
    it('returns a token value', () => {
      const token = getPublicApiToken()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })
  })

  describe('getVisibleTokenPrefix', () => {
    it('handles when no token is set', () => {
      // This will return empty string or actual prefix depending on env.
      const prefix = getVisibleTokenPrefix()
      expect(typeof prefix).toBe('string')
    })
  })

  describe('hasDefaultApiToken', () => {
    it('returns a boolean value', () => {
      const hasToken = hasDefaultApiToken()
      expect(typeof hasToken).toBe('boolean')
    })
  })

  it('sends API tokens via Bearer authorization', async () => {
    const token =
      'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api'

    let receivedAuthorization: string | undefined

    const server = http.createServer((req, res) => {
      receivedAuthorization = req.headers.authorization
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ success: true, data: { organizations: {} } }))
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    const port =
      typeof address === 'object' && address && 'port' in address
        ? address.port
        : 0

    try {
      const sdk = new SocketSdk(token, {
        baseUrl: `http://127.0.0.1:${port}/v0/`,
      })

      try {
        await sdk.listOrganizations()
      } catch {
        // Ignore parse/shape errors; this test only asserts the auth scheme.
      }

      expect(receivedAuthorization).toBe(`Bearer ${token}`)
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    }
  })
})
