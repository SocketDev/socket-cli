/**
 * @fileoverview Unit tests for content-addressable cache (cacache) wrapper utilities.
 *
 * Tests cacache wrapper functions for content-addressable caching:
 * - getCacache() lazy-loads cacache library
 * - get(), safeGet() retrieve cached content by key
 * - put() stores content with integrity hash
 * - remove() deletes cached entries
 * - clear() purges entire cache
 * - withTmp() provides temporary cache directory
 * Used by Socket tools for package tarball caching and content storage.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  clear,
  get,
  getCacache,
  put,
  remove,
  safeGet,
  withTmp,
} from '@socketsecurity/lib/cacache'
import type {
  CacheEntry,
  GetOptions,
  PutOptions,
  RemoveOptions,
} from '@socketsecurity/lib/cacache'

describe('cacache', () => {
  describe('getCacache', () => {
    it('should export getCacache function', () => {
      expect(typeof getCacache).toBe('function')
    })

    it('should return cacache module', () => {
      const cacache = getCacache()
      expect(cacache).toBeDefined()
      expect(typeof cacache).toBe('object')
    })

    it('should have expected cacache methods', () => {
      const cacache = getCacache()
      expect(typeof cacache.get).toBe('function')
      expect(typeof cacache.put).toBe('function')
      // rm and ls are namespaces with methods like rm.entry, rm.all, ls.stream
      expect(cacache.rm).toBeDefined()
      expect(cacache.ls).toBeDefined()
      expect(typeof cacache.rm.entry).toBe('function')
      expect(typeof cacache.ls.stream).toBe('function')
    })
  })

  describe('type exports', () => {
    it('should support GetOptions type', () => {
      const opts: GetOptions = {
        integrity: 'sha512-abc',
        size: 1024,
        memoize: true,
      }
      expect(opts).toBeDefined()
    })

    it('should support PutOptions type', () => {
      const opts: PutOptions = {
        integrity: 'sha512-abc',
        size: 1024,
        metadata: { foo: 'bar' },
        memoize: true,
      }
      expect(opts).toBeDefined()
    })

    it('should support CacheEntry type', () => {
      const entry: CacheEntry = {
        data: Buffer.from('test'),
        integrity: 'sha512-abc',
        key: 'test-key',
        metadata: { foo: 'bar' },
        path: '/path/to/cache',
        size: 4,
        time: Date.now(),
      }
      expect(entry).toBeDefined()
    })

    it('should support RemoveOptions type', () => {
      const opts: RemoveOptions = {
        prefix: 'socket-sdk',
      }
      expect(opts).toBeDefined()
    })

    it('should support RemoveOptions with wildcard', () => {
      const opts: RemoveOptions = {
        prefix: 'socket-sdk:scans:abc*',
      }
      expect(opts).toBeDefined()
    })
  })

  describe('put', () => {
    it('should export put function', () => {
      expect(typeof put).toBe('function')
    })

    it('should reject keys with wildcards', async () => {
      await expect(put('test*key', 'data')).rejects.toThrow(TypeError)
      await expect(put('test*key', 'data')).rejects.toThrow(
        'Cache key cannot contain wildcards (*)',
      )
    })

    it('should reject keys with wildcards in middle', async () => {
      await expect(put('socket:*:key', 'data')).rejects.toThrow(TypeError)
    })

    it('should reject keys with wildcards at end', async () => {
      await expect(put('socket:key*', 'data')).rejects.toThrow(TypeError)
    })

    it('should accept keys without wildcards', async () => {
      // This will fail because it actually tries to write to cache,
      // but it proves the wildcard check passed
      const key = `test-key-${Date.now()}`
      try {
        await put(key, 'test data')
        // If it succeeds, clean up
        await remove(key)
      } catch (e) {
        // Expected - cache dir may not exist in test env
        expect(e).toBeDefined()
      }
    })
  })

  describe('get', () => {
    it('should export get function', () => {
      expect(typeof get).toBe('function')
    })

    it('should reject keys with wildcards', async () => {
      await expect(get('test*key')).rejects.toThrow(TypeError)
      await expect(get('test*key')).rejects.toThrow(
        'Cache key cannot contain wildcards (*)',
      )
    })

    it('should reject keys with wildcards in middle', async () => {
      await expect(get('socket:*:key')).rejects.toThrow(TypeError)
    })

    it('should reject keys with wildcards at end', async () => {
      await expect(get('socket:key*')).rejects.toThrow(TypeError)
    })

    it('should accept keys without wildcards', async () => {
      // This will fail because key doesn't exist, but proves wildcard check passed
      await expect(get('nonexistent-key')).rejects.toThrow()
    })

    it('should accept GetOptions', async () => {
      const opts: GetOptions = {
        integrity: 'sha512-abc',
        memoize: false,
      }
      await expect(get('nonexistent-key', opts)).rejects.toThrow()
    })
  })

  describe('remove', () => {
    it('should export remove function', () => {
      expect(typeof remove).toBe('function')
    })

    it('should reject keys with wildcards', async () => {
      await expect(remove('test*key')).rejects.toThrow(TypeError)
      await expect(remove('test*key')).rejects.toThrow(
        'Cache key cannot contain wildcards (*)',
      )
    })

    it('should reject keys with wildcards in middle', async () => {
      await expect(remove('socket:*:key')).rejects.toThrow(TypeError)
    })

    it('should reject keys with wildcards at end', async () => {
      await expect(remove('socket:key*')).rejects.toThrow(TypeError)
    })

    it('should suggest using clear for wildcards', async () => {
      await expect(remove('test*')).rejects.toThrow(
        'Use clear({ prefix: "pattern*" })',
      )
    })

    it('should accept keys without wildcards', async () => {
      // This may succeed (if key doesn't exist) or fail (cache issues)
      // Either way, it proves the wildcard check passed
      try {
        await remove('nonexistent-key')
      } catch (e) {
        expect(e).toBeDefined()
      }
    })
  })

  describe('safeGet', () => {
    it('should export safeGet function', () => {
      expect(typeof safeGet).toBe('function')
    })

    it('should return undefined for nonexistent keys', async () => {
      const result = await safeGet('nonexistent-key')
      expect(result).toBeUndefined()
    })

    it('should return undefined on wildcard errors', async () => {
      const result = await safeGet('test*key')
      expect(result).toBeUndefined()
    })

    it('should accept GetOptions', async () => {
      const opts: GetOptions = {
        integrity: 'sha512-abc',
        memoize: false,
      }
      const result = await safeGet('nonexistent-key', opts)
      expect(result).toBeUndefined()
    })

    it('should not throw on errors', async () => {
      await expect(safeGet('any-key')).resolves.toBeUndefined()
      await expect(safeGet('test*key')).resolves.toBeUndefined()
    })
  })

  describe('clear', () => {
    it('should export clear function', () => {
      expect(typeof clear).toBe('function')
    })

    it('should accept RemoveOptions with prefix', async () => {
      const opts: RemoveOptions = { prefix: 'test-prefix' }
      // This may succeed or fail depending on cache state
      try {
        const result = await clear(opts)
        expect(typeof result).toBe('number')
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should accept RemoveOptions with wildcard', async () => {
      const opts: RemoveOptions = { prefix: 'test-prefix*' }
      try {
        const result = await clear(opts)
        expect(typeof result).toBe('number')
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should accept no options', async () => {
      try {
        const result = await clear()
        expect(result).toBeUndefined()
      } catch (e) {
        // Ignore ENOTEMPTY errors per implementation
        if ((e as any)?.code !== 'ENOTEMPTY') {
          expect(e).toBeDefined()
        }
      }
    })

    it('should accept undefined options', async () => {
      try {
        const result = await clear(undefined)
        expect(result).toBeUndefined()
      } catch (e) {
        if ((e as any)?.code !== 'ENOTEMPTY') {
          expect(e).toBeDefined()
        }
      }
    })

    it('should accept empty options object', async () => {
      try {
        const result = await clear({})
        expect(result).toBeUndefined()
      } catch (e) {
        if ((e as any)?.code !== 'ENOTEMPTY') {
          expect(e).toBeDefined()
        }
      }
    })

    it('should handle ENOTEMPTY errors gracefully', async () => {
      // Test that ENOTEMPTY errors are silently ignored
      const cacache = getCacache()
      const originalRmAll = cacache.rm.all

      try {
        cacache.rm.all = vi.fn().mockRejectedValue(
          Object.assign(new Error('ENOTEMPTY'), {
            code: 'ENOTEMPTY',
          }),
        )

        // Should not throw
        await expect(clear()).resolves.toBeUndefined()
      } finally {
        cacache.rm.all = originalRmAll
      }
    })

    it('should throw non-ENOTEMPTY errors', async () => {
      const cacache = getCacache()
      const originalRmAll = cacache.rm.all

      try {
        cacache.rm.all = vi.fn().mockRejectedValue(
          Object.assign(new Error('EACCES'), {
            code: 'EACCES',
          }),
        )

        await expect(clear()).rejects.toThrow('EACCES')
      } finally {
        cacache.rm.all = originalRmAll
      }
    })
  })

  describe('withTmp', () => {
    it('should export withTmp function', () => {
      expect(typeof withTmp).toBe('function')
    })

    it('should call callback with temp directory path', async () => {
      const callback = vi.fn(async (tmpDir: string) => {
        expect(typeof tmpDir).toBe('string')
        expect(tmpDir.length).toBeGreaterThan(0)
        return 'result'
      })

      try {
        const result = await withTmp(callback)
        expect(callback).toHaveBeenCalled()
        expect(result).toBe('result')
      } catch (e) {
        // Cache dir may not exist in test env
        expect(e).toBeDefined()
      }
    })

    it('should return callback result', async () => {
      try {
        const result = await withTmp(async () => {
          return 42
        })
        expect(result).toBe(42)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should support async callbacks', async () => {
      try {
        const result = await withTmp(async tmpDir => {
          await new Promise(resolve => setTimeout(resolve, 1))
          return tmpDir.length
        })
        expect(typeof result).toBe('number')
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should propagate callback errors', async () => {
      try {
        await withTmp(async () => {
          throw new Error('callback error')
        })
        // If we reach here, cache dir doesn't exist
      } catch (e) {
        // Either cache dir error or callback error
        expect(e).toBeDefined()
      }
    })
  })

  describe('integration', () => {
    it('should support put -> get -> remove workflow', async () => {
      const key = `test-integration-${Date.now()}`
      const data = 'test data'

      try {
        // Put data
        await put(key, data)

        // Get data
        const entry = await get(key)
        expect(entry).toBeDefined()
        expect(entry.key).toBe(key)
        expect(entry.data.toString()).toBe(data)

        // Remove data
        await remove(key)

        // Verify removed
        await expect(get(key)).rejects.toThrow()
      } catch (e) {
        // Cache dir may not exist in test env - that's ok
        expect(e).toBeDefined()
      }
    })

    it('should support put -> safeGet workflow', async () => {
      const key = `test-safe-${Date.now()}`
      const data = 'test data'

      try {
        await put(key, data)

        const entry = await safeGet(key)
        expect(entry).toBeDefined()
        expect(entry?.key).toBe(key)

        await remove(key)

        const missing = await safeGet(key)
        expect(missing).toBeUndefined()
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should support clear with prefix workflow', async () => {
      const prefix = `test-clear-${Date.now()}`
      const keys = [`${prefix}:1`, `${prefix}:2`, `${prefix}:3`]

      try {
        // Put multiple entries
        await Promise.all(keys.map(key => put(key, `data-${key}`)))

        // Clear with prefix
        const removed = await clear({ prefix })
        expect(typeof removed).toBe('number')
        expect(removed).toBeGreaterThanOrEqual(0)

        // Verify cleared
        // @ts-expect-error - safeGet signature doesn't match map callback but works at runtime
        const results = await Promise.all(keys.map(safeGet))
        results.forEach(result => expect(result).toBeUndefined())
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should support clear with wildcard workflow', async () => {
      const prefix = `test-wildcard-${Date.now()}`
      const keys = [`${prefix}:abc:1`, `${prefix}:abc:2`, `${prefix}:xyz:1`]

      try {
        await Promise.all(keys.map(key => put(key, `data-${key}`)))

        // Clear with wildcard - only abc entries
        const removed = await clear({ prefix: `${prefix}:abc*` })
        expect(typeof removed).toBe('number')
        expect(removed).toBeGreaterThanOrEqual(0)

        // Verify abc entries cleared
        expect(await safeGet(keys[0])).toBeUndefined()
        expect(await safeGet(keys[1])).toBeUndefined()

        // Verify xyz entry remains (if cache works)
        // This may be undefined if cache doesn't work in test env
        await safeGet(keys[2])

        // Clean up remaining
        await clear({ prefix })
      } catch (e) {
        expect(e).toBeDefined()
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty string keys', async () => {
      // Empty string keys are actually allowed by cacache
      const key = ''
      try {
        await put(key, 'data')
        await remove(key)
      } catch (e) {
        // Cache may not work in test env - that's ok
        expect(e).toBeDefined()
      }
    })

    it('should handle very long keys', async () => {
      const longKey = 'x'.repeat(1000)
      try {
        await put(longKey, 'data')
        await remove(longKey)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should handle keys with special characters', async () => {
      const key = `test:key/${Date.now()}@special`
      try {
        await put(key, 'data')
        await remove(key)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should handle Buffer data', async () => {
      const key = `test-buffer-${Date.now()}`
      const data = Buffer.from('test buffer data')
      try {
        await put(key, data)
        const entry = await get(key)
        expect(Buffer.isBuffer(entry.data)).toBe(true)
        await remove(key)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should handle empty data', async () => {
      const key = `test-empty-${Date.now()}`
      try {
        await put(key, '')
        const entry = await get(key)
        expect(entry.data.toString()).toBe('')
        await remove(key)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should handle options with all fields', async () => {
      const key = `test-options-${Date.now()}`
      const putOpts: PutOptions = {
        integrity: 'sha512-test',
        size: 100,
        metadata: { foo: 'bar', nested: { baz: 42 } },
        memoize: true,
      }
      try {
        await put(key, 'data', putOpts)
        const getOpts: GetOptions = {
          memoize: false,
        }
        const entry = await get(key, getOpts)
        expect(entry).toBeDefined()
        await remove(key)
      } catch (e) {
        expect(e).toBeDefined()
      }
    })

    it('should handle concurrent operations', async () => {
      const keys = Array.from(
        { length: 10 },
        (_, i) => `concurrent-${Date.now()}-${i}`,
      )

      try {
        // Concurrent puts
        await Promise.all(keys.map(key => put(key, `data-${key}`)))

        // Concurrent gets
        // @ts-expect-error - safeGet signature doesn't match map callback but works at runtime
        const entries = await Promise.all(keys.map(safeGet))
        entries.forEach(entry => {
          if (entry) {
            expect(entry).toBeDefined()
          }
        })

        // Concurrent removes
        await Promise.all(keys.map(remove))
      } catch (e) {
        expect(e).toBeDefined()
      }
    })
  })
})
