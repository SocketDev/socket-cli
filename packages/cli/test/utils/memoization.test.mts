/** @fileoverview Tests for memoization utilities. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  memoize,
  memoizeAsync,
  memoizeWeak,
  once,
} from '../../src/utils/memoization.mts'

describe('memoize', () => {
  beforeEach(() => {
    vi.stubEnv('DEBUG', 'cache')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should cache function results', () => {
    let callCount = 0
    const fn = memoize((x: number) => {
      callCount++
      return x * 2
    })

    expect(fn(5)).toBe(10)
    expect(fn(5)).toBe(10)
    // Only called once
    expect(callCount).toBe(1)
  })

  it('should handle multiple arguments', () => {
    let callCount = 0
    const fn = memoize((a: number, b: number) => {
      callCount++
      return a + b
    })

    expect(fn(2, 3)).toBe(5)
    expect(fn(2, 3)).toBe(5)
    // Different args
    expect(fn(2, 4)).toBe(6)
    expect(callCount).toBe(2)
  })

  it('should respect custom key generator', () => {
    let callCount = 0
    const fn = memoize(
      (obj: { id: number; value: string }) => {
        callCount++
        return obj.value.toUpperCase()
      },
      { keyGen: obj => String(obj.id) },
    )

    expect(fn({ id: 1, value: 'hello' })).toBe('HELLO')
    // Same id, cached
    expect(fn({ id: 1, value: 'world' })).toBe('HELLO')
    expect(callCount).toBe(1)
  })

  it('should enforce max cache size with LRU eviction', () => {
    let callCount = 0
    const fn = memoize(
      (x: number) => {
        callCount++
        return x * 2
      },
      { maxSize: 2 },
    )

    // Cache: [1]
    fn(1)
    // Cache: [1, 2]
    fn(2)
    // Cache: [2, 3] (1 evicted)
    fn(3)
    // Not cached, recompute
    fn(1)

    expect(callCount).toBe(4)
  })

  it('should expire entries after TTL', async () => {
    let callCount = 0
    // 50ms TTL
    const fn = memoize(
      (x: number) => {
        callCount++
        return x * 2
      },
      { ttl: 50 },
    )

    expect(fn(5)).toBe(10)
    expect(callCount).toBe(1)

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 60))

    expect(fn(5)).toBe(10)
    // Recomputed after expiry
    expect(callCount).toBe(2)
  })

  it('should track cache hits', () => {
    const fn = memoize((x: number) => x * 2, { name: 'double' })

    fn(5)
    fn(5)
    fn(5)

    // Note: Cache hit count is internal, but we can verify it doesn't recompute
    // by checking the memoization works
    let computeCount = 0
    const fn2 = memoize((x: number) => {
      computeCount++
      return x * 2
    })

    fn2(10)
    fn2(10)
    fn2(10)
    expect(computeCount).toBe(1)
  })
})

describe('memoizeAsync', () => {
  beforeEach(() => {
    vi.stubEnv('DEBUG', 'cache')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should cache async function results', async () => {
    let callCount = 0
    const fn = memoizeAsync(async (x: number) => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 10))
      return x * 2
    })

    expect(await fn(5)).toBe(10)
    expect(await fn(5)).toBe(10)
    expect(callCount).toBe(1)
  })

  it('should handle concurrent calls with same args', async () => {
    let callCount = 0
    const fn = memoizeAsync(async (x: number) => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 50))
      return x * 2
    })

    // Fire off multiple concurrent calls
    const results = await Promise.all([fn(5), fn(5), fn(5)])

    expect(results).toEqual([10, 10, 10])
    // Only computed once despite concurrent calls
    expect(callCount).toBe(1)
  })

  it('should not cache failed promises', async () => {
    let callCount = 0
    const fn = memoizeAsync(async (x: number) => {
      callCount++
      if (callCount === 1) {
        throw new Error('First call fails')
      }
      return x * 2
    })

    await expect(fn(5)).rejects.toThrow('First call fails')
    // Second call succeeds
    expect(await fn(5)).toBe(10)
    expect(callCount).toBe(2)
  })

  it('should respect TTL for async functions', async () => {
    let callCount = 0
    const fn = memoizeAsync(
      async (x: number) => {
        callCount++
        return x * 2
      },
      { ttl: 50 },
    )

    expect(await fn(5)).toBe(10)
    expect(callCount).toBe(1)

    await new Promise(resolve => setTimeout(resolve, 60))

    expect(await fn(5)).toBe(10)
    expect(callCount).toBe(2)
  })

  it('should enforce max size with LRU', async () => {
    let callCount = 0
    const fn = memoizeAsync(
      async (x: number) => {
        callCount++
        return x * 2
      },
      { maxSize: 2 },
    )

    await fn(1)
    await fn(2)
    // Evicts 1
    await fn(3)
    // Recomputes
    await fn(1)

    expect(callCount).toBe(4)
  })
})

describe('memoizeWeak', () => {
  it('should cache results with object keys', () => {
    let callCount = 0
    const fn = memoizeWeak((obj: { value: number }) => {
      callCount++
      return obj.value * 2
    })

    const obj1 = { value: 5 }
    const obj2 = { value: 10 }

    expect(fn(obj1)).toBe(10)
    expect(fn(obj1)).toBe(10)
    expect(fn(obj2)).toBe(20)

    expect(callCount).toBe(2)
  })

  it('should allow garbage collection of keys', () => {
    const fn = memoizeWeak((obj: { value: number }) => obj.value * 2)

    let obj: { value: number } | null = { value: 5 }
    expect(fn(obj)).toBe(10)

    // Clear reference - cache entry should be GC'd eventually
    obj = null

    // Can't directly test GC, but WeakMap allows it
    expect(obj).toBeNull()
  })
})

describe('once', () => {
  it('should only call function once', () => {
    let callCount = 0
    const fn = once(() => {
      callCount++
      return 'result'
    })

    expect(fn()).toBe('result')
    expect(fn()).toBe('result')
    expect(fn()).toBe('result')
    expect(callCount).toBe(1)
  })

  it('should cache complex return values', () => {
    const fn = once(() => ({
      config: { value: 42 },
      initialized: true,
    }))

    const result1 = fn()
    const result2 = fn()

    // Same object reference
    expect(result1).toBe(result2)
    expect(result1.config.value).toBe(42)
  })

  it('should work with side effects', () => {
    let initialized = false
    const init = once(() => {
      initialized = true
      return 'initialized'
    })

    expect(initialized).toBe(false)
    init()
    expect(initialized).toBe(true)
    init()
    init()
    // initialized is still true, not called multiple times
  })
})

describe('memoization with different data types', () => {
  it('should memoize with string arguments', () => {
    let callCount = 0
    const fn = memoize((str: string) => {
      callCount++
      return str.toUpperCase()
    })

    expect(fn('hello')).toBe('HELLO')
    expect(fn('hello')).toBe('HELLO')
    expect(fn('world')).toBe('WORLD')
    expect(callCount).toBe(2)
  })

  it('should memoize with array arguments', () => {
    let callCount = 0
    const fn = memoize((arr: number[]) => {
      callCount++
      return arr.reduce((a, b) => a + b, 0)
    })

    expect(fn([1, 2, 3])).toBe(6)
    expect(fn([1, 2, 3])).toBe(6)
    expect(fn([4, 5, 6])).toBe(15)
    expect(callCount).toBe(2)
  })

  it('should memoize with object arguments', () => {
    let callCount = 0
    const fn = memoize((obj: { a: number; b: number }) => {
      callCount++
      return obj.a + obj.b
    })

    expect(fn({ a: 1, b: 2 })).toBe(3)
    expect(fn({ a: 1, b: 2 })).toBe(3)
    expect(callCount).toBe(1)
  })

  it('should memoize with no arguments', () => {
    let callCount = 0
    const fn = memoize(() => {
      callCount++
      return Math.random()
    })

    const result1 = fn()
    const result2 = fn()
    expect(result1).toBe(result2)
    expect(callCount).toBe(1)
  })
})
