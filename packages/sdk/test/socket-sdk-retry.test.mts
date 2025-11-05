/**
 * @fileoverview Tests for SocketSdk retry logic
 * @vitest-environment node
 */

// Run these tests in isolated mode to prevent nock state bleeding
import nock from 'nock'
import { describe, expect, it } from 'vitest'

import { SocketSdk } from '../src/index'
import { setupTestEnvironment } from './utils/environment.mts'

describe('SocketSdk - Retry Logic', () => {
  setupTestEnvironment()

  describe('Authentication Error Handling', () => {
    it('should not retry on 401 authentication errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [401, { error: { message: 'Unauthorized' } }]
        })

      const client = new SocketSdk('invalid-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(401)
      // Should not retry auth errors
      expect(attemptCount).toBe(1)
    })

    it('should not retry on 403 forbidden errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [403, { error: { message: 'Forbidden' } }]
        })

      const client = new SocketSdk('forbidden-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(403)
      // Should not retry forbidden errors
      expect(attemptCount).toBe(1)
    })
  })

  describe('Server Error Retry', () => {
    it('should retry on 500 errors and eventually succeed', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(2)
        .reply(() => {
          attemptCount++
          if (attemptCount < 2) {
            return [500, { error: { message: 'Internal Server Error' } }]
          }
          return [200, { quota: 1000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(1000)
      }
      // Should have retried once before succeeding
      expect(attemptCount).toBe(2)
    })

    it('should retry on 502 bad gateway errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(2)
        .reply(() => {
          attemptCount++
          if (attemptCount < 2) {
            return [502, { error: { message: 'Bad Gateway' } }]
          }
          return [200, { quota: 2000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(2000)
      }
      expect(attemptCount).toBe(2)
    })

    it('should retry on 503 service unavailable errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(2)
        .reply(() => {
          attemptCount++
          if (attemptCount < 2) {
            return [503, 'Service Unavailable']
          }
          return [200, { quota: 3000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(3000)
      }
      expect(attemptCount).toBe(2)
    })

    it('should retry on 504 gateway timeout errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(2)
        .reply(() => {
          attemptCount++
          if (attemptCount < 2) {
            return [504, { error: { message: 'Gateway Timeout' } }]
          }
          return [200, { quota: 4000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(4000)
      }
      expect(attemptCount).toBe(2)
    })

    it('should exhaust retries and throw on persistent 500 errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(4)
        .reply(() => {
          attemptCount++
          return [500, { error: { message: 'Persistent Error' } }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      await expect(client.getQuota()).rejects.toThrow()
      // Initial attempt + 3 retries
      expect(attemptCount).toBe(4)
    })
  })

  describe('Client Error Handling', () => {
    it('should not retry on 400 bad request errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [400, { error: { message: 'Bad Request' } }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(400)
      // Should not retry client errors
      expect(attemptCount).toBe(1)
    })

    it('should not retry on 404 not found errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [404, { error: { message: 'Not Found' } }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(404)
      // Should not retry not found errors
      expect(attemptCount).toBe(1)
    })
  })

  describe('Rate Limit Retry with Retry-After Header', () => {
    it.sequential(
      'should retry 429 with Retry-After delay-seconds header',
      async () => {
        let attemptCount = 0
        const startTime = Date.now()

        nock('https://api.socket.dev')
          .get('/v0/quota')
          .times(2)
          .reply(() => {
            attemptCount++
            if (attemptCount < 2) {
              // First attempt returns 429 with Retry-After in seconds (1 second delay)
              return [
                429,
                { error: { message: 'Too Many Requests' } },
                { 'Retry-After': '1' },
              ]
            }
            return [200, { quota: 1000 }]
          })

        const client = new SocketSdk('test-token', {
          retries: 3,
          retryDelay: 10,
        })

        const result = await client.getQuota()

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.quota).toBe(1000)
        }
        expect(attemptCount).toBe(2)
        // Should have waited at least 1 second (allowing some variance)
        const elapsed = Date.now() - startTime
        expect(elapsed).toBeGreaterThanOrEqual(900)
      },
    )

    it.sequential(
      'should retry 429 with Retry-After HTTP-date header',
      async () => {
        let attemptCount = 0
        const startTime = Date.now()

        nock('https://api.socket.dev')
          .get('/v0/quota')
          .times(2)
          .reply(() => {
            attemptCount++
            if (attemptCount < 2) {
              // Set retry time to 1 second in the future
              const retryDate = new Date(Date.now() + 1000)
              return [
                429,
                { error: { message: 'Too Many Requests' } },
                { 'Retry-After': retryDate.toUTCString() },
              ]
            }
            return [200, { quota: 2000 }]
          })

        const client = new SocketSdk('test-token', {
          retries: 3,
          retryDelay: 10,
        })

        const result = await client.getQuota()

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.quota).toBe(2000)
        }
        expect(attemptCount).toBe(2)
        // Should have waited roughly 1 second (allowing variance for test execution overhead)
        const elapsed = Date.now() - startTime
        expect(elapsed).toBeGreaterThanOrEqual(600)
      },
    )

    it.sequential('should handle Retry-After header as array', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(2)
        .reply(() => {
          attemptCount++
          if (attemptCount < 2) {
            // Return Retry-After as array (some servers might do this)
            return [
              429,
              { error: { message: 'Too Many Requests' } },
              { 'Retry-After': ['1'] },
            ]
          }
          return [200, { quota: 3000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(3000)
      }
      expect(attemptCount).toBe(2)
    })

    it('should not retry 429 without Retry-After header', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          // 429 without Retry-After header
          return [429, { error: { message: 'Too Many Requests' } }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(429)
      // Should not retry without Retry-After header
      expect(attemptCount).toBe(1)
    })

    it('should not retry 429 with invalid Retry-After header', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          // Invalid Retry-After value
          return [
            429,
            { error: { message: 'Too Many Requests' } },
            { 'Retry-After': 'invalid' },
          ]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(429)
      // Should not retry with invalid Retry-After
      expect(attemptCount).toBe(1)
    })

    it('should not retry 429 with past HTTP-date', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          // Date in the past
          const pastDate = new Date(Date.now() - 1000)
          return [
            429,
            { error: { message: 'Too Many Requests' } },
            { 'Retry-After': pastDate.toUTCString() },
          ]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(429)
      // Should not retry with past date
      expect(attemptCount).toBe(1)
    })

    it('should not retry 429 with negative delay-seconds', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [
            429,
            { error: { message: 'Too Many Requests' } },
            { 'Retry-After': '-1' },
          ]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(429)
      // Should not retry with negative delay
      expect(attemptCount).toBe(1)
    })

    it('should handle 429 with empty Retry-After array', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [
            429,
            { error: { message: 'Too Many Requests' } },
            { 'Retry-After': [] },
          ]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(false)
      expect(result.status).toBe(429)
      // Should not retry with empty array
      expect(attemptCount).toBe(1)
    })

    it.sequential(
      'should exhaust retries on persistent 429 with Retry-After',
      async () => {
        let attemptCount = 0

        nock('https://api.socket.dev')
          .get('/v0/quota')
          .times(4)
          .reply(() => {
            attemptCount++
            return [
              429,
              { error: { message: 'Too Many Requests' } },
              { 'Retry-After': '1' },
            ]
          })

        const client = new SocketSdk('test-token', {
          retries: 3,
          retryDelay: 10,
        })

        const result = await client.getQuota()

        // 429 is a client error (4xx), so it returns a result instead of throwing
        expect(result.success).toBe(false)
        expect(result.status).toBe(429)
        // Initial attempt + 3 retries
        expect(attemptCount).toBe(4)
      },
    )
  })

  describe('Network Error Retry', () => {
    it('should retry on network connection errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .replyWithError('ECONNREFUSED')
        .get('/v0/quota')
        .reply(() => {
          attemptCount = 2
          return [200, { quota: 5000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(5000)
      }
      expect(attemptCount).toBe(2)
    })

    it('should retry on timeout errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .replyWithError('ETIMEDOUT')
        .get('/v0/quota')
        .reply(() => {
          attemptCount = 2
          return [200, { quota: 6000 }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.getQuota()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.quota).toBe(6000)
      }
      expect(attemptCount).toBe(2)
    })
  })

  describe('Retry Configuration', () => {
    it.sequential('should respect custom retry count', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .times(6)
        .reply(() => {
          attemptCount++
          return [500, { error: { message: 'Server Error' } }]
        })

      const client = new SocketSdk('test-token', {
        retries: 5,
        retryDelay: 10,
      })

      await expect(client.getQuota()).rejects.toThrow()
      // Initial attempt + 5 retries
      expect(attemptCount).toBe(6)
    })

    it('should work with retries disabled', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .get('/v0/quota')
        .reply(() => {
          attemptCount++
          return [500, { error: { message: 'Server Error' } }]
        })

      const client = new SocketSdk('test-token', {
        retries: 0,
        retryDelay: 10,
      })

      await expect(client.getQuota()).rejects.toThrow()
      // Should only attempt once
      expect(attemptCount).toBe(1)
    })
  })

  describe('Retry with Different Methods', () => {
    it('should retry POST requests on 500 errors', async () => {
      let attemptCount = 0

      nock('https://api.socket.dev')
        .post('/v0/settings')
        .times(2)
        .reply(() => {
          attemptCount++
          if (attemptCount < 2) {
            return [500, { error: { message: 'Internal Server Error' } }]
          }
          return [200, { success: true }]
        })

      const client = new SocketSdk('test-token', {
        retries: 3,
        retryDelay: 10,
      })

      const result = await client.postSettings([{ organization: 'test-org' }])

      expect(result.success).toBe(true)
      expect(attemptCount).toBe(2)
    })
  })
})
