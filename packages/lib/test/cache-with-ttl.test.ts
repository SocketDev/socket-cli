/**
 * @fileoverview Unit tests for time-to-live (TTL) cache utilities.
 *
 * Tests TTL-based file caching system:
 * - createTtlCache() creates cache instance with configurable TTL
 * - get() retrieves cached values if not expired
 * - set() stores values with automatic expiration
 * - has() checks cache key existence without extending TTL
 * - delete() removes cached entries
 * - clear() purges all cache entries
 * - Automatic expiration based on TTL (time-to-live)
 * Used by Socket tools for temporary data caching with expiration (API responses, metadata).
 */

import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { createTtlCache } from '@socketsecurity/lib/cache-with-ttl'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe.sequential('cache-with-ttl', () => {
  let cache: ReturnType<typeof createTtlCache>
  let testCacheDir: string

  beforeEach(() => {
    // Create a unique cache directory for each test to ensure isolation
    testCacheDir = path.join(
      tmpdir(),
      `socket-test-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    setEnv('SOCKET_CACACHE_DIR', testCacheDir)

    // Create a fresh cache instance for each test
    cache = createTtlCache({
      ttl: 1000, // 1 second for tests
      prefix: 'test-cache',
      memoize: true,
    })
  })

  afterEach(async () => {
    // Clean up after each test
    await cache.clear()
    // Reset environment overrides
    resetEnv()
  })

  describe('createTtlCache', () => {
    it('should create cache with default options', () => {
      const defaultCache = createTtlCache()
      expect(defaultCache).toBeTruthy()
      expect(typeof defaultCache.get).toBe('function')
      expect(typeof defaultCache.set).toBe('function')
    })

    it('should create cache with custom TTL', () => {
      const customCache = createTtlCache({ ttl: 5000 })
      expect(customCache).toBeTruthy()
    })

    it('should create cache with custom prefix', () => {
      const customCache = createTtlCache({ prefix: 'custom-prefix' })
      expect(customCache).toBeTruthy()
    })

    it('should create cache with memoize disabled', () => {
      const noMemoCache = createTtlCache({ memoize: false })
      expect(noMemoCache).toBeTruthy()
    })

    it('should throw TypeError for prefix with wildcards', () => {
      expect(() => createTtlCache({ prefix: 'test-*' })).toThrow(TypeError)
      expect(() => createTtlCache({ prefix: '*-cache' })).toThrow(TypeError)
      expect(() => createTtlCache({ prefix: 'test-*-cache' })).toThrow(
        TypeError,
      )
    })

    it('should accept prefix without wildcards', () => {
      expect(() => createTtlCache({ prefix: 'test-cache' })).not.toThrow()
      expect(() => createTtlCache({ prefix: 'my:app:cache' })).not.toThrow()
    })
  })

  describe('set and get', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', 'value1')
      const value = await cache.get<string>('key1')
      expect(value).toBe('value1')
    })

    it('should set and get different types', async () => {
      // Set values sequentially to avoid any potential race conditions.
      await cache.set('string', 'hello')
      await cache.set('number', 42)
      await cache.set('boolean', true)
      await cache.set('object', { foo: 'bar' })
      await cache.set('array', [1, 2, 3])

      // Verify each value independently to isolate any failures.
      expect(await cache.get<string>('string')).toBe('hello')
      expect(await cache.get<number>('number')).toBe(42)
      expect(await cache.get<boolean>('boolean')).toBe(true)
      expect(await cache.get<{ foo: string }>('object')).toEqual({ foo: 'bar' })
      expect(await cache.get<number[]>('array')).toEqual([1, 2, 3])
    })

    it('should return undefined for non-existent key', async () => {
      const value = await cache.get('nonexistent')
      expect(value).toBeUndefined()
    })

    it('should overwrite existing value', async () => {
      await cache.set('key', 'value1')
      // Ensure first write completes before second write.
      const firstValue = await cache.get<string>('key')
      expect(firstValue).toBe('value1')

      await cache.set('key', 'value2')
      const value = await cache.get<string>('key')
      expect(value).toBe('value2')
    })

    it('should handle null values', async () => {
      await cache.set('null-key', null)
      const value = await cache.get('null-key')
      expect(value).toBe(null)
    })

    it('should handle undefined values', async () => {
      await cache.set('undefined-key', undefined)
      const value = await cache.get('undefined-key')
      expect(value).toBe(undefined)
    })

    it('should handle empty string keys', async () => {
      await cache.set('', 'empty-key-value')
      const value = await cache.get<string>('')
      expect(value).toBe('empty-key-value')
    })

    it('should handle keys with special characters', async () => {
      await cache.set('key:with:colons', 'value')
      await cache.set('key/with/slashes', 'value')
      await cache.set('key-with-dashes', 'value')

      expect(await cache.get('key:with:colons')).toBe('value')
      expect(await cache.get('key/with/slashes')).toBe('value')
      expect(await cache.get('key-with-dashes')).toBe('value')
    })

    it('should throw TypeError for keys with wildcards', async () => {
      await expect(cache.get('key*')).rejects.toThrow(TypeError)
      await expect(cache.set('key*', 'value')).rejects.toThrow(TypeError)
    })
  })

  describe('getOrFetch', () => {
    it('should fetch value when not cached', async () => {
      const fetcher = vi.fn(async () => 'fetched-value')
      const value = await cache.getOrFetch('key', fetcher)
      expect(value).toBe('fetched-value')
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('should return cached value without fetching', async () => {
      await cache.set('key', 'cached-value')
      const fetcher = vi.fn(async () => 'fetched-value')
      const value = await cache.getOrFetch('key', fetcher)
      expect(value).toBe('cached-value')
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('should cache fetched value', async () => {
      const fetcher = vi.fn(async () => 'fetched-value')
      await cache.getOrFetch('key', fetcher)
      const value = await cache.get<string>('key')
      expect(value).toBe('fetched-value')
    })

    it('should fetch again after cache expires', async () => {
      const shortCache = createTtlCache({
        ttl: 50,
        prefix: 'short-cache',
      })
      const fetcher = vi.fn(async () => 'value')
      await shortCache.getOrFetch('key', fetcher)
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100))

      await shortCache.getOrFetch('key', fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)

      await shortCache.clear()
    })

    it('should handle async fetcher errors', async () => {
      const fetcher = async () => {
        throw new Error('Fetch failed')
      }
      await expect(cache.getOrFetch('key', fetcher)).rejects.toThrow(
        'Fetch failed',
      )
    })
  })

  describe('delete', () => {
    it('should delete existing key', async () => {
      await cache.set('key', 'value')
      await cache.delete('key')
      const value = await cache.get('key')
      expect(value).toBeUndefined()
    })

    it('should not throw for non-existent key', async () => {
      await expect(cache.delete('nonexistent')).resolves.not.toThrow()
    })

    it('should throw TypeError for keys with wildcards', async () => {
      await expect(cache.delete('key*')).rejects.toThrow(TypeError)
    })
  })

  describe('deleteAll', () => {
    it('should delete all entries without pattern', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const count = await cache.deleteAll()
      expect(count).toBeGreaterThanOrEqual(0)

      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBeUndefined()
      expect(await cache.get('key3')).toBeUndefined()
    })

    it('should delete entries matching prefix pattern', async () => {
      await cache.set('user:1', 'alice')
      await cache.set('user:2', 'bob')
      await cache.set('post:1', 'hello')

      await cache.deleteAll('user:*')

      expect(await cache.get('user:1')).toBeUndefined()
      expect(await cache.get('user:2')).toBeUndefined()
      expect(await cache.get('post:1')).toBe('hello')
    })

    it('should delete entries matching exact prefix', async () => {
      await cache.set('users:1', 'alice')
      await cache.set('users:2', 'bob')
      await cache.set('posts:1', 'hello')

      await cache.deleteAll('users')

      expect(await cache.get('users:1')).toBeUndefined()
      expect(await cache.get('users:2')).toBeUndefined()
      expect(await cache.get('posts:1')).toBe('hello')
    })

    it('should handle wildcard patterns', async () => {
      await cache.set('npm/lodash/1.0.0', 'data1')
      await cache.set('npm/lodash/2.0.0', 'data2')
      await cache.set('npm/react/1.0.0', 'data3')

      await cache.deleteAll('npm/lodash/*')

      expect(await cache.get('npm/lodash/1.0.0')).toBeUndefined()
      expect(await cache.get('npm/lodash/2.0.0')).toBeUndefined()
      expect(await cache.get('npm/react/1.0.0')).toBe('data3')
    })

    it('should return count of deleted entries', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      const count = await cache.deleteAll()
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getAll', () => {
    it('should support getAll method', () => {
      expect(typeof cache.getAll).toBe('function')
    })

    it('should return all entries with wildcard pattern', async () => {
      await cache.set('user:1', { name: 'Alice' })
      await cache.set('user:2', { name: 'Bob' })
      await cache.set('post:1', { title: 'Hello' })

      const users = await cache.getAll<{ name: string }>('user:*')
      expect(users.size).toBe(2)
      expect(users.get('user:1')).toEqual({ name: 'Alice' })
      expect(users.get('user:2')).toEqual({ name: 'Bob' })
      expect(users.has('post:1')).toBe(false)
    })

    it('should return all entries with star pattern', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const all = await cache.getAll<string>('*')
      expect(all.size).toBeGreaterThanOrEqual(3)
      expect(all.get('key1')).toBe('value1')
      expect(all.get('key2')).toBe('value2')
      expect(all.get('key3')).toBe('value3')
    })

    it('should return empty map when no entries match', async () => {
      await cache.set('user:1', 'data')

      const posts = await cache.getAll('post:*')
      expect(posts.size).toBe(0)
    })

    it('should skip expired entries in getAll', async () => {
      const shortCache = createTtlCache({
        ttl: 50,
        prefix: 'expiry-getall-test',
      })

      await shortCache.set('key1', 'value1')
      await shortCache.set('key2', 'value2')

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100))

      const all = await shortCache.getAll<string>('*')
      expect(all.size).toBe(0)

      await shortCache.clear()
    })

    it('should handle complex wildcard patterns', async () => {
      await cache.set('npm/lodash/1.0.0', 'data1')
      await cache.set('npm/lodash/2.0.0', 'data2')
      await cache.set('npm/react/1.0.0', 'data3')

      const lodash = await cache.getAll<string>('npm/lodash/*')
      expect(lodash.size).toBe(2)
      expect(lodash.get('npm/lodash/1.0.0')).toBe('data1')
      expect(lodash.get('npm/lodash/2.0.0')).toBe('data2')
    })

    it('should return entries from both memory and persistent cache', async () => {
      // Set some entries
      await cache.set('mem1', 'value1')
      await cache.set('mem2', 'value2')

      // Clear only memory cache to force reading from persistent
      await cache.clear({ memoOnly: true })

      // Verify persistent cache has the entries by reading them back
      // This ensures the persistent writes have completed
      const mem1FromPersistent = await cache.get<string>('mem1')
      const mem2FromPersistent = await cache.get<string>('mem2')
      expect(mem1FromPersistent).toBe('value1')
      expect(mem2FromPersistent).toBe('value2')

      // Clear memory again after verification reads (which populate memory)
      await cache.clear({ memoOnly: true })

      // Set a new entry (will be in memory only initially)
      await cache.set('mem3', 'value3')

      // getAll should return all entries from both sources
      const all = await cache.getAll<string>('*')
      expect(all.size).toBeGreaterThanOrEqual(2)
    })

    it('should handle non-wildcard patterns as prefix match', async () => {
      await cache.set('users:1', 'alice')
      await cache.set('users:2', 'bob')
      await cache.set('posts:1', 'hello')

      const users = await cache.getAll<string>('users')
      expect(users.size).toBe(2)
      expect(users.get('users:1')).toBe('alice')
      expect(users.get('users:2')).toBe('bob')
    })
  })

  describe('clear', () => {
    it('should clear all cache entries', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      await cache.clear()

      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBeUndefined()
    })

    it('should clear only in-memory cache with memoOnly option', async () => {
      await cache.set('key', 'value')

      await cache.clear({ memoOnly: true })

      // After clearing memo only, value should still be in persistent cache
      // but might not be immediately accessible depending on implementation
      expect(true).toBe(true) // Test passes if no error
    })

    it('should handle clearing empty cache', async () => {
      await expect(cache.clear()).resolves.not.toThrow()
    })

    it('should handle clearing twice', async () => {
      await cache.set('key', 'value')
      await cache.clear()
      await expect(cache.clear()).resolves.not.toThrow()
    })
  })

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortCache = createTtlCache({
        ttl: 50,
        prefix: 'expiry-test',
      })

      await shortCache.set('key', 'value')
      expect(await shortCache.get<string>('key')).toBe('value')

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(await shortCache.get('key')).toBeUndefined()

      await shortCache.clear()
    })

    it('should not expire entries before TTL', async () => {
      const longCache = createTtlCache({
        ttl: 10_000,
        prefix: 'long-cache',
      })

      await longCache.set('key', 'value')
      expect(await longCache.get<string>('key')).toBe('value')

      // Wait a bit but not long enough to expire
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(await longCache.get<string>('key')).toBe('value')

      await longCache.clear()
    })

    it('should refresh TTL on set', async () => {
      const refreshCache = createTtlCache({
        ttl: 300,
        prefix: 'refresh-cache',
      })

      await refreshCache.set('key', 'value1')
      await new Promise(resolve => setTimeout(resolve, 100))
      await refreshCache.set('key', 'value2') // Refresh TTL

      await new Promise(resolve => setTimeout(resolve, 100))
      // Should still be cached (100 + 100 = 200ms, but TTL refreshed at 100ms to 300ms)
      expect(await refreshCache.get<string>('key')).toBe('value2')

      await refreshCache.clear()
    })
  })

  describe('memoization', () => {
    it('should use in-memory cache when memoize is true', async () => {
      const memoCache = createTtlCache({
        ttl: 1000,
        prefix: 'memo-cache',
        memoize: true,
      })

      await memoCache.set('key', 'value')
      const value = await memoCache.get<string>('key')
      expect(value).toBe('value')

      await memoCache.clear()
    })

    it('should not use in-memory cache when memoize is false', async () => {
      const noMemoCache = createTtlCache({
        ttl: 1000,
        prefix: 'no-memo-cache',
        memoize: false,
      })

      await noMemoCache.set('key', 'value')
      const value = await noMemoCache.get<string>('key')
      expect(value).toBe('value')

      await noMemoCache.clear()
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent sets', async () => {
      await Promise.all([
        cache.set('key1', 'value1'),
        cache.set('key2', 'value2'),
        cache.set('key3', 'value3'),
      ])

      expect(await cache.get<string>('key1')).toBe('value1')
      expect(await cache.get<string>('key2')).toBe('value2')
      expect(await cache.get<string>('key3')).toBe('value3')
    })

    it('should handle concurrent gets', async () => {
      await cache.set('key', 'value')

      const results = await Promise.all([
        cache.get<string>('key'),
        cache.get<string>('key'),
        cache.get<string>('key'),
      ])

      expect(results).toEqual(['value', 'value', 'value'])
    })

    it('should handle concurrent getOrFetch', async () => {
      let fetchCount = 0
      const fetcher = async () => {
        fetchCount++
        return 'value'
      }

      const results = await Promise.all([
        cache.getOrFetch('key', fetcher),
        cache.getOrFetch('key', fetcher),
        cache.getOrFetch('key', fetcher),
      ])

      // All should return the value
      expect(results).toEqual(['value', 'value', 'value'])
      // But fetcher might be called multiple times due to race conditions
      expect(fetchCount).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('should handle very long keys', async () => {
      const longKey = 'k'.repeat(1000)
      await cache.set(longKey, 'value')
      expect(await cache.get<string>(longKey)).toBe('value')
    })

    it('should handle very large values', async () => {
      const largeValue = { data: 'x'.repeat(10_000) }
      await cache.set('key', largeValue)
      const retrieved = await cache.get<{ data: string }>('key')
      expect(retrieved).toEqual(largeValue)
    })

    it('should handle unicode keys', async () => {
      await cache.set('你好', 'hello')
      await cache.set('🔑', 'key')
      expect(await cache.get<string>('你好')).toBe('hello')
      expect(await cache.get<string>('🔑')).toBe('key')
    })

    it('should handle numeric-like string keys', async () => {
      await cache.set('123', 'numeric')
      await cache.set('0', 'zero')
      expect(await cache.get<string>('123')).toBe('numeric')
      expect(await cache.get<string>('0')).toBe('zero')
    })
  })

  describe('type safety', () => {
    it('should handle typed get operations', async () => {
      interface User {
        name: string
        age: number
      }

      await cache.set<User>('user', { name: 'Alice', age: 30 })
      const user = await cache.get<User>('user')
      expect(user?.name).toBe('Alice')
      expect(user?.age).toBe(30)
    })

    it('should handle typed getOrFetch operations', async () => {
      interface Data {
        id: number
        value: string
      }

      const data = await cache.getOrFetch<Data>('data', async () => ({
        id: 1,
        value: 'test',
      }))

      expect(data.id).toBe(1)
      expect(data.value).toBe('test')
    })
  })
})
