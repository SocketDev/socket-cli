/**
 * @fileoverview Generic TTL-based caching utility using cacache.
 *
 * Provides a simple interface for caching data with time-to-live (TTL) expiration.
 * Uses cacache for persistent storage with metadata for TTL tracking.
 *
 * Features:
 * - Automatic expiration based on TTL
 * - In-memory memoization for hot data
 * - Persistent storage across process restarts
 * - Type-safe with generics
 *
 * Usage:
 * ```ts
 * const cache = createTtlCache({ ttl: 5 * 60 * 1000 }) // 5 minutes
 * const data = await cache.getOrFetch('key', async () => fetchData())
 * ```
 */

import * as cacache from './cacache'

export interface TtlCacheOptions {
  /**
   * Time-to-live in milliseconds.
   * @default 5 * 60 * 1000 (5 minutes)
   */
  ttl?: number | undefined
  /**
   * Enable in-memory memoization for hot data.
   * @default true
   */
  memoize?: boolean | undefined
  /**
   * Custom cache key prefix.
   * Must not contain wildcards (*).
   * Use clear({ prefix: "pattern*" }) for wildcard matching instead.
   *
   * @default 'ttl-cache'
   * @throws {TypeError} If prefix contains wildcards
   *
   * @example
   * // Valid
   * createTtlCache({ prefix: 'socket-sdk' })
   * createTtlCache({ prefix: 'my-app:cache' })
   *
   * @example
   * // Invalid - throws TypeError
   * createTtlCache({ prefix: 'socket-*' })
   */
  prefix?: string | undefined
}

export interface TtlCacheEntry<T> {
  data: T
  expiresAt: number
}

export interface ClearOptions {
  /**
   * Only clear in-memory memoization cache, not persistent cache.
   * Useful for forcing a refresh of cached data without removing it from disk.
   *
   * @default false
   */
  memoOnly?: boolean | undefined
}

export interface TtlCache {
  /**
   * Get cached data without fetching.
   * Returns undefined if not found or expired.
   *
   * @param key - Cache key (must not contain wildcards)
   * @throws {TypeError} If key contains wildcards (*)
   */
  get<T>(key: string): Promise<T | undefined>
  /**
   * Get all cached entries matching a pattern.
   * Supports wildcards (*) for flexible matching.
   *
   * @param pattern - Key pattern (supports * wildcards, or use '*' for all entries)
   * @returns Map of matching entries (key -> value)
   *
   * @example
   * // Get all organization entries
   * const orgs = await cache.getAll<OrgData>('organizations:*')
   * for (const [key, org] of orgs) {
   *   console.log(`${key}: ${org.name}`)
   * }
   *
   * @example
   * // Get all entries with this cache's prefix
   * const all = await cache.getAll<any>('*')
   */
  getAll<T>(pattern: string): Promise<Map<string, T>>
  /**
   * Get cached data or fetch and cache if missing/expired.
   *
   * @param key - Cache key (must not contain wildcards)
   */
  getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T>
  /**
   * Set cached data with TTL.
   *
   * @param key - Cache key (must not contain wildcards)
   * @throws {TypeError} If key contains wildcards (*)
   */
  set<T>(key: string, data: T): Promise<void>
  /**
   * Delete a specific cache entry.
   *
   * @param key - Cache key (must not contain wildcards)
   * @throws {TypeError} If key contains wildcards (*)
   */
  delete(key: string): Promise<void>
  /**
   * Delete all cache entries matching a pattern.
   * Supports wildcards (*) for flexible matching.
   *
   * @param pattern - Key pattern (supports * wildcards, or omit to delete all)
   * @returns Number of entries deleted
   *
   * @example
   * // Delete all entries with this cache's prefix
   * await cache.deleteAll()
   *
   * @example
   * // Delete entries matching prefix
   * await cache.deleteAll('organizations')
   *
   * @example
   * // Delete entries with wildcard pattern
   * await cache.deleteAll('scans:abc*')
   * await cache.deleteAll('npm/lodash/*')
   */
  deleteAll(pattern?: string | undefined): Promise<number>
  /**
   * Clear all cache entries (like Map.clear()).
   * Optionally clear only in-memory cache.
   *
   * @param options - Optional configuration
   * @param options.memoOnly - If true, only clears in-memory cache
   *
   * @example
   * // Clear everything (memory + disk)
   * await cache.clear()
   *
   * @example
   * // Clear only in-memory cache (force refresh)
   * await cache.clear({ memoOnly: true })
   */
  clear(options?: ClearOptions | undefined): Promise<void>
}

// 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_PREFIX = 'ttl-cache'

/**
 * Create a TTL-based cache instance.
 */
export function createTtlCache(options?: TtlCacheOptions): TtlCache {
  const opts = {
    __proto__: null,
    memoize: true,
    prefix: DEFAULT_PREFIX,
    ttl: DEFAULT_TTL_MS,
    ...options,
  } as Required<TtlCacheOptions>

  // Validate prefix does not contain wildcards.
  if (opts.prefix?.includes('*')) {
    throw new TypeError(
      'Cache prefix cannot contain wildcards (*). Use clear({ prefix: "pattern*" }) for wildcard matching.',
    )
  }

  // In-memory cache for hot data
  const memoCache = new Map<string, TtlCacheEntry<any>>()

  // Ensure ttl is defined
  const ttl = opts.ttl ?? DEFAULT_TTL_MS

  /**
   * Build full cache key with prefix.
   */
  function buildKey(key: string): string {
    return `${opts.prefix}:${key}`
  }

  /**
   * Check if entry is expired.
   */
  function isExpired(entry: TtlCacheEntry<any>): boolean {
    return Date.now() > entry.expiresAt
  }

  /**
   * Create a matcher function for a pattern (with wildcard support).
   * Returns a function that tests if a key matches the pattern.
   */
  function createMatcher(pattern: string): (key: string) => boolean {
    const fullPattern = buildKey(pattern)
    const hasWildcard = pattern.includes('*')

    if (!hasWildcard) {
      // Simple prefix matching (fast path).
      return (key: string) => key.startsWith(fullPattern)
    }

    // Wildcard matching with regex.
    const escaped = fullPattern.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&')
    const regexPattern = escaped.replaceAll('*', '.*')
    const regex = new RegExp(`^${regexPattern}`)
    return (key: string) => regex.test(key)
  }

  /**
   * Get cached data without fetching.
   *
   * @throws {TypeError} If key contains wildcards (*)
   */
  async function get<T>(key: string): Promise<T | undefined> {
    if (key.includes('*')) {
      throw new TypeError(
        'Cache key cannot contain wildcards (*). Use getAll(pattern) to retrieve multiple entries.',
      )
    }

    const fullKey = buildKey(key)

    // Check in-memory cache first.
    if (opts.memoize) {
      const memoEntry = memoCache.get(fullKey)
      if (memoEntry && !isExpired(memoEntry)) {
        return memoEntry.data as T
      }
      // Remove expired memo entry.
      if (memoEntry) {
        memoCache.delete(fullKey)
      }
    }

    // Check persistent cache.
    const cacheEntry = await cacache.safeGet(fullKey)
    if (cacheEntry) {
      const entry = JSON.parse(
        cacheEntry.data.toString('utf8'),
      ) as TtlCacheEntry<T>
      if (!isExpired(entry)) {
        // Update in-memory cache.
        if (opts.memoize) {
          memoCache.set(fullKey, entry)
        }
        return entry.data
      }
      // Remove expired entry.
      await cacache.remove(fullKey)
    }

    return undefined
  }

  /**
   * Get all cached entries matching a pattern.
   * Supports wildcards (*) for flexible matching.
   */
  async function getAll<T>(pattern: string): Promise<Map<string, T>> {
    const results = new Map<string, T>()
    const matches = createMatcher(pattern)

    // Check in-memory cache first.
    if (opts.memoize) {
      for (const [key, entry] of memoCache.entries()) {
        if (!matches(key)) {
          continue
        }

        // Skip if expired.
        if (isExpired(entry)) {
          memoCache.delete(key)
          continue
        }

        // Add to results (strip cache prefix from key).
        const originalKey = key.slice((opts.prefix?.length ?? 0) + 1)
        results.set(originalKey, entry.data as T)
      }
    }

    // Check persistent cache for entries not in memory.
    const cacheDir = (await import('./paths')).getSocketCacacheDir()
    const cacacheModule = (await import('./cacache')) as any
    const stream = cacacheModule.getCacache().ls.stream(cacheDir)

    for await (const cacheEntry of stream) {
      // Skip if doesn't match our cache prefix.
      if (!cacheEntry.key.startsWith(`${opts.prefix}:`)) {
        continue
      }

      // Skip if doesn't match pattern.
      if (!matches(cacheEntry.key)) {
        continue
      }

      // Skip if already in results (from memory).
      const originalKey = cacheEntry.key.slice((opts.prefix?.length ?? 0) + 1)
      if (results.has(originalKey)) {
        continue
      }

      // Get entry from cache.
      try {
        const entry = await cacache.safeGet(cacheEntry.key)
        if (!entry) {
          continue
        }

        const parsed = JSON.parse(
          entry.data.toString('utf8'),
        ) as TtlCacheEntry<T>

        // Skip if expired.
        if (isExpired(parsed)) {
          await cacache.remove(cacheEntry.key)
          continue
        }

        // Add to results.
        results.set(originalKey, parsed.data)

        // Update in-memory cache.
        if (opts.memoize) {
          memoCache.set(cacheEntry.key, parsed)
        }
      } catch {
        // Ignore parse errors or other issues.
      }
    }

    return results
  }

  /**
   * Set cached data with TTL.
   *
   * @throws {TypeError} If key contains wildcards (*)
   */
  async function set<T>(key: string, data: T): Promise<void> {
    if (key.includes('*')) {
      throw new TypeError(
        'Cache key cannot contain wildcards (*). Wildcards are only supported in clear({ prefix: "pattern*" }).',
      )
    }

    const fullKey = buildKey(key)
    const entry: TtlCacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttl,
    }

    // Update in-memory cache first (synchronous and fast).
    if (opts.memoize) {
      memoCache.set(fullKey, entry)
    }

    // Update persistent cache (don't fail if this errors).
    // In-memory cache is already updated, so immediate reads will succeed.
    try {
      await cacache.put(fullKey, JSON.stringify(entry), {
        metadata: { expiresAt: entry.expiresAt },
      })
    } catch {
      // Ignore persistent cache errors - in-memory cache is the source of truth.
      // This can happen during test setup or if the cache directory is not accessible.
    }
  }

  /**
   * Get cached data or fetch and cache if missing/expired.
   */
  async function getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = await get<T>(key)
    if (cached !== undefined) {
      return cached
    }

    const data = await fetcher()
    await set(key, data)
    return data
  }

  /**
   * Delete a specific cache entry.
   *
   * @throws {TypeError} If key contains wildcards (*)
   */
  async function deleteEntry(key: string): Promise<void> {
    if (key.includes('*')) {
      throw new TypeError(
        'Cache key cannot contain wildcards (*). Use deleteAll(pattern) to remove multiple entries.',
      )
    }

    const fullKey = buildKey(key)
    memoCache.delete(fullKey)
    await cacache.remove(fullKey)
  }

  /**
   * Delete all cache entries matching a pattern.
   * Supports wildcards (*) in patterns.
   * Delegates to cacache.clear() which handles pattern matching efficiently.
   */
  async function deleteAll(pattern?: string | undefined): Promise<number> {
    // Build full prefix/pattern by combining cache prefix with optional pattern.
    const fullPrefix = pattern ? `${opts.prefix}:${pattern}` : opts.prefix

    // Delete matching in-memory entries.
    if (!pattern) {
      // Delete all in-memory entries for this cache.
      memoCache.clear()
    } else {
      // Delete matching in-memory entries using shared matcher logic.
      const matches = createMatcher(pattern)
      for (const key of memoCache.keys()) {
        if (matches(key)) {
          memoCache.delete(key)
        }
      }
    }

    // Delete matching persistent cache entries.
    // Delegate to cacache.clear() which handles wildcards efficiently.
    const removed = await cacache.clear({ prefix: fullPrefix })
    return (removed ?? 0) as number
  }

  /**
   * Clear all cache entries (like Map.clear()).
   * Optionally clear only in-memory cache.
   */
  async function clear(options?: ClearOptions | undefined): Promise<void> {
    const opts = { __proto__: null, ...options } as ClearOptions

    // Clear in-memory cache.
    memoCache.clear()

    // If memoOnly, stop here.
    if (opts.memoOnly) {
      return
    }

    // Clear persistent cache.
    await deleteAll()
  }

  return {
    clear,
    delete: deleteEntry,
    deleteAll,
    get,
    getAll,
    getOrFetch,
    set,
  }
}
