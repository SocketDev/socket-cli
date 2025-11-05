/** @fileoverview Tests for organization entitlements and enabled products. */
import nock from 'nock'
import { describe, expect, it } from 'vitest'

import { setupTestClient } from './utils/environment.mts'

import type { Entitlement, EntitlementsResponse } from '../src/index'

describe('Entitlements API', () => {
  const getClient = setupTestClient('test-api-token', {
    retries: 0,
  })

  describe('getEntitlements', () => {
    it('should return all entitlements for an organization', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'firewall', enabled: true },
          { key: 'scanning', enabled: false },
          { key: 'alerts', enabled: true },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/test-org/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEntitlements('test-org')

      expect(result).toHaveLength(3)
      expect(result).toEqual([
        { key: 'firewall', enabled: true },
        { key: 'scanning', enabled: false },
        { key: 'alerts', enabled: true },
      ])
    })

    it('should handle empty entitlements response', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/empty-org/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEntitlements('empty-org')

      expect(result).toHaveLength(0)
      expect(result).toEqual([])
    })
  })

  describe('getEnabledEntitlements', () => {
    it('should return only enabled product keys', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'firewall', enabled: true },
          { key: 'scanning', enabled: false },
          { key: 'alerts', enabled: true },
          { key: 'dependency-check', enabled: false },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/test-org/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements('test-org')

      expect(result).toHaveLength(2)
      expect(result).toEqual(['firewall', 'alerts'])
    })

    it('should return empty array when no products are enabled', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'firewall', enabled: false },
          { key: 'scanning', enabled: false },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/no-enabled-org/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements('no-enabled-org')

      expect(result).toHaveLength(0)
      expect(result).toEqual([])
    })

    it('should handle empty entitlements response', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/empty-org/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements('empty-org')

      expect(result).toHaveLength(0)
      expect(result).toEqual([])
    })

    it('should URL encode organization slug', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [{ key: 'firewall', enabled: true }],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/test%40org/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements('test@org')

      expect(result).toEqual(['firewall'])
    })

    it('should handle special characters in organization slug', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'firewall', enabled: true },
          { key: 'scanning', enabled: false },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/my-org%2Btest%23123/entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements('my-org+test#123')

      expect(result).toEqual(['firewall'])
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors for getEntitlements', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/error-org/entitlements')
        .replyWithError('Network error')

      await expect(getClient().getEntitlements('error-org')).rejects.toThrow(
        'GET request failed',
      )
    })

    it('should handle network errors for getEnabledEntitlements', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/error-org/entitlements')
        .replyWithError('Connection refused')

      await expect(
        getClient().getEnabledEntitlements('error-org'),
      ).rejects.toThrow('GET request failed')
    })

    it('should handle 401 unauthorized errors', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/auth-error-org/entitlements')
        .reply(401, { error: { message: 'Unauthorized' } })

      await expect(
        getClient().getEntitlements('auth-error-org'),
      ).rejects.toThrow()
    })

    it('should handle 403 forbidden errors', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/forbidden-org/entitlements')
        .reply(403, { error: { message: 'Forbidden' } })

      await expect(
        getClient().getEnabledEntitlements('forbidden-org'),
      ).rejects.toThrow()
    })

    it('should handle 404 not found errors', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/nonexistent-org/entitlements')
        .reply(404, { error: { message: 'Organization not found' } })

      await expect(
        getClient().getEntitlements('nonexistent-org'),
      ).rejects.toThrow()
    })

    it('should handle 500 server errors', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/server-error-org/entitlements')
        .reply(500, { error: { message: 'Internal server error' } })

      await expect(
        getClient().getEnabledEntitlements('server-error-org'),
      ).rejects.toThrow()
    })

    it('should handle malformed JSON responses', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/malformed-org/entitlements')
        .reply(200, 'invalid json{')

      await expect(
        getClient().getEntitlements('malformed-org'),
      ).rejects.toThrow()
    })

    it('should handle null response data', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/null-org/entitlements')
        .times(2)
        .reply(200, '')

      const entitlements = await getClient().getEntitlements('null-org')
      const enabledProducts =
        await getClient().getEnabledEntitlements('null-org')

      expect(entitlements).toEqual([])
      expect(enabledProducts).toEqual([])
    })

    it('should handle response without items property', async () => {
      nock('https://api.socket.dev')
        .get('/v0/orgs/no-items-org/entitlements')
        .times(2)
        .reply(200, {})

      const entitlements = await getClient().getEntitlements('no-items-org')
      const enabledProducts =
        await getClient().getEnabledEntitlements('no-items-org')

      expect(entitlements).toEqual([])
      expect(enabledProducts).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    it('should handle items with missing properties', async () => {
      const mockResponse = {
        items: [
          { key: 'firewall', enabled: true },
          // missing enabled property
          { key: 'incomplete' },
          // missing key property
          { enabled: true },
          // null item
          null,
          // undefined item
          undefined,
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/incomplete-org/entitlements')
        .times(2)
        .reply(200, mockResponse)

      const entitlements = await getClient().getEntitlements('incomplete-org')
      const enabledProducts =
        await getClient().getEnabledEntitlements('incomplete-org')

      expect(entitlements).toHaveLength(5)
      // Only the first complete enabled item
      expect(enabledProducts).toHaveLength(1)
      expect(enabledProducts).toEqual(['firewall'])
    })

    it('should handle large number of entitlements', async () => {
      const items = Array.from({ length: 100 }, (_: unknown, i: number) => ({
        key: `product-${i}`,
        // Every other one enabled
        enabled: i % 2 === 0,
      }))

      const mockResponse: EntitlementsResponse = { items }

      nock('https://api.socket.dev')
        .get('/v0/orgs/large-org/entitlements')
        .times(2)
        .reply(200, mockResponse)

      const entitlements = await getClient().getEntitlements('large-org')
      const enabledProducts =
        await getClient().getEnabledEntitlements('large-org')

      expect(entitlements).toHaveLength(100)
      // Half enabled
      expect(enabledProducts).toHaveLength(50)
    })

    it('should handle entitlements with special characters in keys', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'fire-wall', enabled: true },
          { key: 'scan_ning', enabled: false },
          { key: 'alert.system', enabled: true },
          { key: 'dependency@check', enabled: false },
          { key: 'security/audit', enabled: true },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/special-keys-org/entitlements')
        .reply(200, mockResponse)

      const enabledProducts =
        await getClient().getEnabledEntitlements('special-keys-org')

      expect(enabledProducts).toEqual([
        'fire-wall',
        'alert.system',
        'security/audit',
      ])
    })

    it('should handle empty string organization slug', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [{ key: 'firewall', enabled: true }],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs//entitlements')
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements('')

      expect(result).toEqual(['firewall'])
    })

    it('should handle very long organization slug', async () => {
      const longSlug = `very-long-organization-slug-${'x'.repeat(100)}`
      const encodedSlug = encodeURIComponent(longSlug)

      const mockResponse: EntitlementsResponse = {
        items: [{ key: 'firewall', enabled: true }],
      }

      nock('https://api.socket.dev')
        .get(`/v0/orgs/${encodedSlug}/entitlements`)
        .reply(200, mockResponse)

      const result = await getClient().getEnabledEntitlements(longSlug)

      expect(result).toEqual(['firewall'])
    })
  })

  describe('Performance and Stress Tests', () => {
    it('should handle concurrent requests to the same org', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'firewall', enabled: true },
          { key: 'scanning', enabled: false },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/concurrent-org/entitlements')
        .times(5)
        .reply(200, mockResponse)

      const client = getClient()
      const promises = Array.from(
        { length: 5 },
        (): Promise<string[]> =>
          client.getEnabledEntitlements('concurrent-org'),
      )

      const settled = await Promise.allSettled(promises)
      const results = settled
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)

      results.forEach((result: string[]) => {
        expect(result).toEqual(['firewall'])
      })
    })

    it('should handle concurrent requests to different orgs', async () => {
      for (let i = 0; i < 10; i++) {
        nock('https://api.socket.dev')
          .get(`/v0/orgs/org-${i}/entitlements`)
          .reply(200, {
            items: [{ key: `product-${i}`, enabled: true }],
          })
      }

      const client = getClient()
      const promises = Array.from(
        { length: 10 },
        (_: unknown, i: number): Promise<string[]> =>
          client.getEnabledEntitlements(`org-${i}`),
      )

      const settled = await Promise.allSettled(promises)
      const results = settled
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)

      results.forEach((result: string[], i: number) => {
        expect(result).toEqual([`product-${i}`])
      })
    })
  })

  describe('Type Safety', () => {
    it('should maintain type safety for entitlement objects', async () => {
      const mockResponse: EntitlementsResponse = {
        items: [
          { key: 'firewall', enabled: true },
          { key: 'scanning', enabled: false },
        ],
      }

      nock('https://api.socket.dev')
        .get('/v0/orgs/type-test-org/entitlements')
        .reply(200, mockResponse)

      const entitlements = await getClient().getEntitlements('type-test-org')

      // Verify TypeScript types are preserved
      entitlements.forEach((entitlement: Entitlement) => {
        expect(typeof entitlement.key).toBe('string')
        expect(typeof entitlement.enabled).toBe('boolean')
      })
    })
  })
})
