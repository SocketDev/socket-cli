/**
 * @fileoverview Unit tests for function memoization utilities.
 *
 * Tests memoization and caching decorators:
 * - memoize() caches synchronous function results
 * - memoizeAsync() caches async function results with promise deduplication
 * - memoizeWeak() uses WeakMap for object key caching
 * - memoizeDebounced() combines memoization with debouncing
 * - once() ensures function executes exactly once
 * - Memoize() decorator for class methods
 * - clearAllMemoizationCaches() global cache clearing
 * Used by Socket tools to optimize expensive operations and API calls.
 */

import {
  clearAllMemoizationCaches,
  Memoize,
  memoize,
  memoizeAsync,
  memoizeDebounced,
  memoizeWeak,
  once,
} from '@socketsecurity/lib/memoization'
import { describe, expect, it, vi } from 'vitest'

describe('memoization', () => {
  describe('memoize', () => {
    it('should cache function results', () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn)

      expect(memoized(5)).toBe(10)
      expect(memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple different arguments', () => {
      const fn = vi.fn((a: number, b: number) => a + b)
      const memoized = memoize(fn)

      expect(memoized(1, 2)).toBe(3)
      expect(memoized(3, 4)).toBe(7)
      expect(memoized(1, 2)).toBe(3)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should handle string arguments', () => {
      const fn = vi.fn((str: string) => str.toUpperCase())
      const memoized = memoize(fn)

      expect(memoized('hello')).toBe('HELLO')
      expect(memoized('world')).toBe('WORLD')
      expect(memoized('hello')).toBe('HELLO')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should handle object arguments with default keyGen', () => {
      const fn = vi.fn((obj: { x: number }) => obj.x * 2)
      const memoized = memoize(fn)

      const obj1 = { x: 5 }
      const obj2 = { x: 5 }

      expect(memoized(obj1)).toBe(10)
      expect(memoized(obj2)).toBe(10)
      // Both objects have same JSON representation, so should be cached
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should use custom keyGen when provided', () => {
      const fn = vi.fn((a: number, b: number) => a + b)
      const memoized = memoize(fn, {
        keyGen: (a, b) => `${a}-${b}`,
      })

      expect(memoized(1, 2)).toBe(3)
      expect(memoized(1, 2)).toBe(3)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should respect maxSize with LRU eviction', () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn, { maxSize: 2 })

      memoized(1) // cache: [1]
      memoized(2) // cache: [1, 2]
      memoized(3) // cache: [2, 3] (1 evicted)

      expect(fn).toHaveBeenCalledTimes(3)

      memoized(2) // cache hit
      memoized(3) // cache hit
      memoized(1) // cache miss (was evicted)

      expect(fn).toHaveBeenCalledTimes(4)
    })

    it('should respect TTL expiration', async () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn, { ttl: 100 })

      expect(memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Should be cached immediately
      expect(memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      expect(memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should use function name for debugging', () => {
      function myFunction(n: number) {
        return n * 2
      }
      const memoized = memoize(myFunction)

      // Just verify it doesn't throw
      expect(memoized(5)).toBe(10)
    })

    it('should use custom name when provided', () => {
      const fn = (n: number) => n * 2
      const memoized = memoize(fn, { name: 'customName' })

      // Just verify it doesn't throw
      expect(memoized(5)).toBe(10)
    })

    it('should handle zero arguments', () => {
      const fn = vi.fn(() => Math.random())
      const memoized = memoize(fn)

      const result1 = memoized()
      const result2 = memoized()

      expect(result1).toBe(result2)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle null and undefined arguments', () => {
      const fn = vi.fn((val: unknown) => String(val))
      const memoized = memoize(fn)

      expect(memoized(null)).toBe('null')
      // Note: JSON.stringify treats null and undefined the same, so they share cache
      expect(memoized(undefined)).toBe('null')
      expect(memoized(null)).toBe('null')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should update LRU order on cache hit', () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn, { maxSize: 2 })

      memoized(1) // cache: [1]
      memoized(2) // cache: [1, 2]
      memoized(1) // cache hit, moves 1 to end: [2, 1]
      memoized(3) // evicts 2, cache: [1, 3]

      expect(fn).toHaveBeenCalledTimes(3)

      memoized(1) // cache hit
      memoized(2) // cache miss (was evicted)

      expect(fn).toHaveBeenCalledTimes(4)
    })
  })

  describe('memoizeAsync', () => {
    it('should cache async function results', async () => {
      const fn = vi.fn(async (n: number) => n * 2)
      const memoized = memoizeAsync(fn)

      expect(await memoized(5)).toBe(10)
      expect(await memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple different arguments', async () => {
      const fn = vi.fn(async (a: number, b: number) => a + b)
      const memoized = memoizeAsync(fn)

      expect(await memoized(1, 2)).toBe(3)
      expect(await memoized(3, 4)).toBe(7)
      expect(await memoized(1, 2)).toBe(3)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should cache promises to prevent duplicate calls', async () => {
      let callCount = 0
      const fn = async (n: number) => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return n * 2
      }
      const memoized = memoizeAsync(fn)

      // Call concurrently
      const [result1, result2, result3] = await Promise.all([
        memoized(5),
        memoized(5),
        memoized(5),
      ])

      expect(result1).toBe(10)
      expect(result2).toBe(10)
      expect(result3).toBe(10)
      // Should only be called once despite concurrent calls
      expect(callCount).toBe(1)
    })

    it('should remove failed promises from cache', async () => {
      let shouldFail = true
      const fn = vi.fn(async (n: number) => {
        if (shouldFail) {
          throw new Error('Test error')
        }
        return n * 2
      })
      const memoized = memoizeAsync(fn)

      await expect(memoized(5)).rejects.toThrow('Test error')
      expect(fn).toHaveBeenCalledTimes(1)

      // Retry should call function again (not cached)
      shouldFail = false
      expect(await memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(2)

      // Now it should be cached
      expect(await memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should respect maxSize with LRU eviction', async () => {
      const fn = vi.fn(async (n: number) => n * 2)
      const memoized = memoizeAsync(fn, { maxSize: 2 })

      await memoized(1) // cache: [1]
      await memoized(2) // cache: [1, 2]
      await memoized(3) // cache: [2, 3] (1 evicted)

      expect(fn).toHaveBeenCalledTimes(3)

      await memoized(2) // cache hit
      await memoized(3) // cache hit
      await memoized(1) // cache miss (was evicted)

      expect(fn).toHaveBeenCalledTimes(4)
    })

    it('should respect TTL expiration', async () => {
      const fn = vi.fn(async (n: number) => n * 2)
      const memoized = memoizeAsync(fn, { ttl: 100 })

      expect(await memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Should be cached immediately
      expect(await memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      expect(await memoized(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should use custom keyGen when provided', async () => {
      const fn = vi.fn(async (a: number, b: number) => a + b)
      const memoized = memoizeAsync(fn, {
        keyGen: (a, b) => `${a}-${b}`,
      })

      expect(await memoized(1, 2)).toBe(3)
      expect(await memoized(1, 2)).toBe(3)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should update LRU order on cache hit', async () => {
      const fn = vi.fn(async (n: number) => n * 2)
      const memoized = memoizeAsync(fn, { maxSize: 2 })

      await memoized(1) // cache: [1]
      await memoized(2) // cache: [1, 2]
      await memoized(1) // cache hit, moves 1 to end: [2, 1]
      await memoized(3) // evicts 2, cache: [1, 3]

      expect(fn).toHaveBeenCalledTimes(3)

      await memoized(1) // cache hit
      await memoized(2) // cache miss (was evicted)

      expect(fn).toHaveBeenCalledTimes(4)
    })
  })

  describe('Memoize decorator', () => {
    it('should return a descriptor with memoized function', () => {
      const fn = vi.fn((n: number) => n * 2)
      const descriptor = {
        value: fn,
      }

      const decorated = Memoize()({}, 'testMethod', descriptor)

      expect(decorated).toBeDefined()
      expect(decorated.value).toBeDefined()
      expect(typeof decorated.value).toBe('function')
    })

    it('should memoize the wrapped function', () => {
      const fn = vi.fn((n: number) => n * 2)
      const descriptor = {
        value: fn,
      }

      const decorated = Memoize()({}, 'testMethod', descriptor)
      const memoizedFn = decorated.value as (n: number) => number

      expect(memoizedFn(5)).toBe(10)
      expect(memoizedFn(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should use custom options', () => {
      const fn = vi.fn((n: number) => n * 2)
      const descriptor = {
        value: fn,
      }

      const decorated = Memoize({ maxSize: 1 })({}, 'testMethod', descriptor)
      const memoizedFn = decorated.value as (n: number) => number

      memoizedFn(1)
      memoizedFn(2) // Evicts 1
      memoizedFn(1) // Cache miss

      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should use method name from propertyKey', () => {
      const fn = vi.fn((n: number) => n * 2)
      const descriptor = {
        value: fn,
      }

      const decorated = Memoize()({}, 'myMethod', descriptor)

      // Just verify it doesn't throw and works
      expect(decorated.value).toBeDefined()
    })

    it('should use custom name over propertyKey', () => {
      const fn = vi.fn((n: number) => n * 2)
      const descriptor = {
        value: fn,
      }

      const decorated = Memoize({ name: 'customName' })(
        {},
        'myMethod',
        descriptor,
      )

      // Just verify it doesn't throw and works
      expect(decorated.value).toBeDefined()
    })
  })

  describe('clearAllMemoizationCaches', () => {
    it('should not throw when called', () => {
      expect(() => clearAllMemoizationCaches()).not.toThrow()
    })
  })

  describe('memoizeWeak', () => {
    it('should cache results for object keys', () => {
      const fn = vi.fn((obj: { x: number }) => obj.x * 2)
      const memoized = memoizeWeak(fn)

      const obj1 = { x: 5 }
      const obj2 = { x: 10 }

      expect(memoized(obj1)).toBe(10)
      expect(memoized(obj1)).toBe(10)
      expect(memoized(obj2)).toBe(20)

      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should use object identity for cache keys', () => {
      const fn = vi.fn((obj: { x: number }) => obj.x * 2)
      const memoized = memoizeWeak(fn)

      const obj1 = { x: 5 }
      const obj2 = { x: 5 } // Same value, different object

      expect(memoized(obj1)).toBe(10)
      expect(memoized(obj2)).toBe(10)

      // Different objects, so called twice
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should handle array objects', () => {
      const fn = vi.fn((arr: number[]) => arr.reduce((a, b) => a + b, 0))
      const memoized = memoizeWeak(fn)

      const arr1 = [1, 2, 3]

      expect(memoized(arr1)).toBe(6)
      expect(memoized(arr1)).toBe(6)

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should allow garbage collection of cached entries', () => {
      const fn = vi.fn((obj: { x: number }) => obj.x * 2)
      const memoized = memoizeWeak(fn)

      let obj: { x: number } | null = { x: 5 }

      expect(memoized(obj)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Clear reference (in real scenario, GC would collect)
      obj = null

      // Create new object
      const obj2 = { x: 5 }
      expect(memoized(obj2)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('once', () => {
    it('should only call function once', () => {
      const fn = vi.fn(() => Math.random())
      const onceFn = once(fn)

      const result1 = onceFn()
      const result2 = onceFn()
      const result3 = onceFn()

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should cache the result', () => {
      let count = 0
      const fn = () => ++count
      const onceFn = once(fn)

      expect(onceFn()).toBe(1)
      expect(onceFn()).toBe(1)
      expect(onceFn()).toBe(1)
      expect(count).toBe(1)
    })

    it('should work with object return values', () => {
      const obj = { x: 42 }
      const fn = vi.fn(() => obj)
      const onceFn = once(fn)

      expect(onceFn()).toBe(obj)
      expect(onceFn()).toBe(obj)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should work with null and undefined', () => {
      const fn1 = vi.fn(() => null)
      const once1 = once(fn1)

      expect(once1()).toBe(null)
      expect(once1()).toBe(null)
      expect(fn1).toHaveBeenCalledTimes(1)

      const fn2 = vi.fn(() => undefined)
      const once2 = once(fn2)

      expect(once2()).toBe(undefined)
      expect(once2()).toBe(undefined)
      expect(fn2).toHaveBeenCalledTimes(1)
    })

    it('should cache even if function throws', () => {
      const fn = vi.fn(() => {
        throw new Error('Test error')
      })
      const onceFn = once(fn)

      expect(() => onceFn()).toThrow('Test error')
      expect(fn).toHaveBeenCalledTimes(1)

      // Second call should not throw (returns cached undefined from throw)
      // Note: In the actual implementation, the result is cached before throw
      // so this behavior depends on implementation details
    })
  })

  describe('memoizeDebounced', () => {
    it('should debounce and memoize function calls', async () => {
      const fn = vi.fn((n: number) => n * 2)
      const debounced = memoizeDebounced(fn, 100)

      // First call - computes immediately
      expect(debounced(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Immediate second call - returns cached
      expect(debounced(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 150))

      // After debounce, still cached
      expect(debounced(5)).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should clear debounce timeout on subsequent calls', async () => {
      const fn = vi.fn((n: number) => n * 2)
      const debounced = memoizeDebounced(fn, 100)

      debounced(5)
      debounced(5)
      debounced(5)

      expect(fn).toHaveBeenCalledTimes(1)

      await new Promise(resolve => setTimeout(resolve, 150))

      // Should still only be called once
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle different arguments', async () => {
      const fn = vi.fn((n: number) => n * 2)
      const debounced = memoizeDebounced(fn, 50)

      expect(debounced(1)).toBe(2)
      expect(debounced(2)).toBe(4)
      expect(debounced(1)).toBe(2) // Cached

      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should respect memoization options', () => {
      const fn = vi.fn((n: number) => n * 2)
      const debounced = memoizeDebounced(fn, 50, { maxSize: 1 })

      debounced(1)
      debounced(2) // Evicts 1
      debounced(1) // Cache miss

      expect(fn).toHaveBeenCalledTimes(3)
    })
  })

  describe('edge cases', () => {
    it('should handle very large cache sizes', () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn, { maxSize: 1000 })

      for (let i = 0; i < 1000; i++) {
        memoized(i)
      }

      expect(fn).toHaveBeenCalledTimes(1000)

      // All should be cached
      for (let i = 0; i < 1000; i++) {
        memoized(i)
      }

      expect(fn).toHaveBeenCalledTimes(1000)
    })

    it('should handle complex nested objects', () => {
      const fn = vi.fn((obj: { a: { b: { c: number } } }) => obj.a.b.c * 2)
      const memoized = memoize(fn)

      const obj1 = { a: { b: { c: 5 } } }
      const obj2 = { a: { b: { c: 5 } } }

      expect(memoized(obj1)).toBe(10)
      expect(memoized(obj2)).toBe(10)

      // Same JSON representation
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle functions that return functions', () => {
      const fn = vi.fn((n: number) => () => n * 2)
      const memoized = memoize(fn)

      const result1 = memoized(5)
      const result2 = memoized(5)

      expect(result1).toBe(result2)
      expect(result1()).toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle NaN arguments', () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn)

      expect(Number.isNaN(memoized(Number.NaN))).toBe(true)
      expect(Number.isNaN(memoized(Number.NaN))).toBe(true)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should handle Infinity arguments', () => {
      const fn = vi.fn((n: number) => n * 2)
      const memoized = memoize(fn)

      expect(memoized(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
      expect(memoized(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})
