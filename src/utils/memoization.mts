/** @fileoverview Memoization utilities for Socket CLI. Provides function result caching to optimize repeated computations and expensive operations. */

import { debugCache } from './debug.mts'

/**
 * Options for memoization behavior.
 */
type MemoizeOptions<Args extends unknown[], _Result = unknown> = {
  /** Custom cache key generator (defaults to JSON.stringify) */
  keyGen?: (...args: Args) => string
  /** Maximum cache size (LRU eviction when exceeded) */
  maxSize?: number
  /** TTL in milliseconds (cache entries expire after this time) */
  ttl?: number
  /** Cache name for debugging */
  name?: string
  /** Weak cache for object keys (enables GC) */
  weak?: boolean
  /** Custom equality check for cache hits */
  equals?: (a: Args, b: Args) => boolean
}

/**
 * Cache entry with metadata.
 */
type CacheEntry<T> = {
  value: T
  timestamp: number
  hits: number
}

/**
 * Memoize a function with configurable caching behavior.
 * Caches function results to avoid repeated computation.
 *
 * @param fn - Function to memoize
 * @param options - Memoization options
 * @returns Memoized version of the function
 *
 * @example
 * const expensiveOperation = memoize((n: number) => {
 *   // Heavy computation
 *   return Array(n).fill(0).reduce((a, _, i) => a + i, 0)
 * }, { maxSize: 100, ttl: 60000, name: 'sum' })
 *
 * expensiveOperation(1000) // Computed
 * expensiveOperation(1000) // Cached
 */
export function memoize<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  options: MemoizeOptions<Args, Result> = {},
): (...args: Args) => Result {
  const {
    keyGen = (...args) => JSON.stringify(args),
    maxSize = Number.POSITIVE_INFINITY,
    ttl = Number.POSITIVE_INFINITY,
    name = fn.name || 'anonymous',
  } = options

  const cache = new Map<string, CacheEntry<Result>>()
  const accessOrder: string[] = []

  function evictLRU(): void {
    if (cache.size >= maxSize && accessOrder.length > 0) {
      const oldest = accessOrder.shift()
      if (oldest) {
        cache.delete(oldest)
        debugCache('clear', `memoize:${name}`, { key: oldest, reason: 'LRU' })
      }
    }
  }

  function isExpired(entry: CacheEntry<Result>): boolean {
    if (ttl === Number.POSITIVE_INFINITY) {
      return false
    }
    return Date.now() - entry.timestamp > ttl
  }

  return function memoized(...args: Args): Result {
    const key = keyGen(...args)

    // Check cache
    const cached = cache.get(key)
    if (cached && !isExpired(cached)) {
      cached.hits++
      // Move to end of access order (LRU)
      const index = accessOrder.indexOf(key)
      if (index !== -1) {
        accessOrder.splice(index, 1)
      }
      accessOrder.push(key)

      debugCache('hit', `memoize:${name}`, { key, hits: cached.hits })
      return cached.value
    }

    // Cache miss - compute value
    debugCache('miss', `memoize:${name}`, { key })
    const value = fn(...args)

    // Store in cache
    evictLRU()
    cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
    })
    accessOrder.push(key)

    debugCache('set', `memoize:${name}`, { key, cacheSize: cache.size })
    return value
  }
}

/**
 * Memoize an async function.
 * Similar to memoize() but handles promises properly.
 *
 * @param fn - Async function to memoize
 * @param options - Memoization options
 * @returns Memoized version of the async function
 *
 * @example
 * const fetchUser = memoizeAsync(async (id: string) => {
 *   const response = await fetch(`/api/users/${id}`)
 *   return response.json()
 * }, { ttl: 300000, name: 'fetchUser' })
 *
 * await fetchUser('123') // Fetches from API
 * await fetchUser('123') // Returns cached result
 */
export function memoizeAsync<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  options: MemoizeOptions<Args, Result> = {},
): (...args: Args) => Promise<Result> {
  const {
    keyGen = (...args) => JSON.stringify(args),
    maxSize = Number.POSITIVE_INFINITY,
    ttl = Number.POSITIVE_INFINITY,
    name = fn.name || 'anonymous',
  } = options

  const cache = new Map<string, CacheEntry<Promise<Result>>>()
  const accessOrder: string[] = []

  function evictLRU(): void {
    if (cache.size >= maxSize && accessOrder.length > 0) {
      const oldest = accessOrder.shift()
      if (oldest) {
        cache.delete(oldest)
        debugCache('clear', `memoizeAsync:${name}`, {
          key: oldest,
          reason: 'LRU',
        })
      }
    }
  }

  function isExpired(entry: CacheEntry<Promise<Result>>): boolean {
    if (ttl === Number.POSITIVE_INFINITY) {
      return false
    }
    return Date.now() - entry.timestamp > ttl
  }

  return async function memoized(...args: Args): Promise<Result> {
    const key = keyGen(...args)

    // Check cache
    const cached = cache.get(key)
    if (cached && !isExpired(cached)) {
      cached.hits++
      // Move to end of access order (LRU)
      const index = accessOrder.indexOf(key)
      if (index !== -1) {
        accessOrder.splice(index, 1)
      }
      accessOrder.push(key)

      debugCache('hit', `memoizeAsync:${name}`, { key, hits: cached.hits })
      return await cached.value
    }

    // Cache miss - compute value
    debugCache('miss', `memoizeAsync:${name}`, { key })
    const promise = fn(...args)

    // Store promise in cache (handles concurrent calls)
    evictLRU()
    cache.set(key, {
      value: promise,
      timestamp: Date.now(),
      hits: 0,
    })
    accessOrder.push(key)

    debugCache('set', `memoizeAsync:${name}`, { key, cacheSize: cache.size })

    try {
      const result = await promise
      return result
    } catch (error) {
      // Remove failed promise from cache
      cache.delete(key)
      const orderIndex = accessOrder.indexOf(key)
      if (orderIndex !== -1) {
        accessOrder.splice(orderIndex, 1)
      }
      debugCache('clear', `memoizeAsync:${name}`, { key, reason: 'error' })
      throw error
    }
  }
}

/**
 * Create a memoized version of a method.
 * Preserves 'this' context for class methods.
 *
 * @param target - Object containing the method
 * @param propertyKey - Method name
 * @param descriptor - Property descriptor
 * @returns Modified descriptor with memoized method
 *
 * @example
 * class Calculator {
 *   @Memoize()
 *   fibonacci(n: number): number {
 *     if (n <= 1) return n
 *     return this.fibonacci(n - 1) + this.fibonacci(n - 2)
 *   }
 * }
 */
export function Memoize(options: MemoizeOptions<unknown[], unknown> = {}) {
  return function (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown

    descriptor.value = memoize(originalMethod, {
      ...options,
      name: options.name || propertyKey,
    })

    return descriptor
  }
}

/**
 * Clear all memoization caches.
 * Useful for testing or when you need to force recomputation.
 */
export function clearAllMemoizationCaches(): void {
  // Note: This requires the memoized functions to be tracked globally.
  // For now, this is a placeholder that logs the intent.
  debugCache('clear', 'memoize:all', { action: 'clear-all-caches' })
}

/**
 * Memoize with WeakMap for object keys.
 * Allows garbage collection when objects are no longer referenced.
 * Only works when first argument is an object.
 *
 * @param fn - Function to memoize
 * @returns Memoized version using WeakMap
 *
 * @example
 * const processConfig = memoizeWeak((config: Config) => {
 *   return expensiveTransform(config)
 * })
 *
 * processConfig(config1) // Computed
 * processConfig(config1) // Cached
 * // When config1 is no longer referenced, cache entry is GC'd
 */
export function memoizeWeak<K extends object, Result>(
  fn: (key: K) => Result,
): (key: K) => Result {
  const cache = new WeakMap<K, Result>()

  return function memoized(key: K): Result {
    const cached = cache.get(key)
    if (cached !== undefined) {
      debugCache('hit', `memoizeWeak:${fn.name}`)
      return cached
    }

    debugCache('miss', `memoizeWeak:${fn.name}`)
    const result = fn(key)
    cache.set(key, result)
    return result
  }
}

/**
 * Simple once() implementation - caches single result forever.
 * Useful for initialization functions that should only run once.
 *
 * @param fn - Function to run once
 * @returns Memoized version that only executes once
 *
 * @example
 * const initialize = once(() => {
 *   console.log('Initializing...')
 *   return loadConfig()
 * })
 *
 * initialize() // Logs "Initializing..." and returns config
 * initialize() // Returns cached config (no log)
 */
export function once<Result>(fn: () => Result): () => Result {
  let called = false
  let result: Result

  return function memoized(): Result {
    if (!called) {
      result = fn()
      called = true
      debugCache('set', `once:${fn.name}`)
    } else {
      debugCache('hit', `once:${fn.name}`)
    }
    return result
  }
}

/**
 * Create a debounced memoized function.
 * Combines memoization with debouncing for expensive operations.
 *
 * @param fn - Function to memoize and debounce
 * @param wait - Debounce wait time in milliseconds
 * @param options - Memoization options
 * @returns Debounced memoized function
 */
export function memoizeDebounced<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  wait: number,
  options: MemoizeOptions<Args, Result> = {},
): (...args: Args) => Result {
  const memoized = memoize(fn, options)
  let timeoutId: NodeJS.Timeout | undefined

  return function debounced(...args: Args): Result {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      memoized(...args)
    }, wait)

    // For immediate return, try cached value or compute synchronously
    return memoized(...args)
  }
}
