/** @fileoverview Cacache utilities for Socket ecosystem shared content-addressable cache. */

import { getSocketCacacheDir } from './paths'

export interface GetOptions {
  integrity?: string | undefined
  size?: number | undefined
  memoize?: boolean | undefined
}

export interface PutOptions {
  integrity?: string | undefined
  size?: number | undefined
  metadata?: any | undefined
  memoize?: boolean | undefined
}

export interface CacheEntry {
  data: Buffer
  integrity: string
  key: string
  metadata?: any | undefined
  path: string
  size: number
  time: number
}

export interface RemoveOptions {
  /**
   * Optional key prefix to filter removals.
   * If provided, only keys starting with this prefix will be removed.
   * Can include wildcards (*) for pattern matching.
   *
   * @example
   * { prefix: 'socket-sdk' } // Simple prefix
   * { prefix: 'socket-sdk:scans:abc*' } // With wildcard
   */
  prefix?: string | undefined
}

/**
 * Get the cacache module for cache operations.
 */
export function getCacache() {
  return /*@__PURE__*/ require('cacache')
}

/**
 * Convert wildcard pattern to regex for matching.
 * Supports * as wildcard (matches any characters).
 */
function patternToRegex(pattern: string): RegExp {
  // Escape regex special characters except *
  const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&')
  // Convert * to .* (match any characters)
  const regexPattern = escaped.replaceAll('*', '.*')
  return new RegExp(`^${regexPattern}`)
}

/**
 * Check if a key matches a pattern (with wildcard support).
 */
function matchesPattern(key: string, pattern: string): boolean {
  // If no wildcards, use simple prefix matching (faster)
  if (!pattern.includes('*')) {
    return key.startsWith(pattern)
  }
  // Use regex for wildcard patterns
  const regex = patternToRegex(pattern)
  return regex.test(key)
}

/**
 * Clear entries from the Socket shared cache.
 *
 * Supports wildcard patterns (*) in prefix for flexible matching.
 * For simple prefixes without wildcards, uses efficient streaming.
 * For wildcard patterns, iterates and matches each entry.
 *
 * @param options - Optional configuration for selective clearing
 * @param options.prefix - Prefix or pattern to match (supports * wildcards)
 * @returns Number of entries removed (only when prefix is specified)
 *
 * @example
 * // Clear all entries
 * await clear()
 *
 * @example
 * // Clear entries with simple prefix
 * const removed = await clear({ prefix: 'socket-sdk:scans' })
 * console.log(`Removed ${removed} scan cache entries`)
 *
 * @example
 * // Clear entries with wildcard pattern
 * await clear({ prefix: 'socket-sdk:scans:abc*' })
 * await clear({ prefix: 'socket-sdk:npm/lodash/*' })
 */
export async function clear(
  options?: RemoveOptions | undefined,
): Promise<number | undefined> {
  const opts = { __proto__: null, ...options } as RemoveOptions
  const cacache = getCacache()
  const cacheDir = getSocketCacacheDir()

  // If no prefix specified, clear everything.
  if (!opts.prefix) {
    try {
      await cacache.rm.all(cacheDir)
      return
    } catch (e) {
      // Ignore ENOTEMPTY errors - can occur when multiple processes
      // are cleaning up concurrently (e.g., in CI test environments).
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOTEMPTY') {
        throw e
      }
      return
    }
  }

  const hasWildcard = opts.prefix.includes('*')

  // For simple prefix (no wildcards), use faster iteration.
  if (!hasWildcard) {
    let removed = 0
    const stream = cacache.ls.stream(cacheDir)

    for await (const entry of stream) {
      if (entry.key.startsWith(opts.prefix)) {
        try {
          await cacache.rm.entry(cacheDir, entry.key)
          removed++
        } catch {
          // Ignore individual removal errors (e.g., already removed by another process).
        }
      }
    }

    return removed
  }

  // For wildcard patterns, need to match each entry.
  let removed = 0
  const stream = cacache.ls.stream(cacheDir)

  for await (const entry of stream) {
    if (matchesPattern(entry.key, opts.prefix)) {
      try {
        await cacache.rm.entry(cacheDir, entry.key)
        removed++
      } catch {
        // Ignore individual removal errors.
      }
    }
  }

  return removed
}

/**
 * Get data from the Socket shared cache by key.
 * @throws {Error} When cache entry is not found.
 * @throws {TypeError} If key contains wildcards (*)
 */
export async function get(
  key: string,
  options?: GetOptions | undefined,
): Promise<CacheEntry> {
  if (key.includes('*')) {
    throw new TypeError(
      'Cache key cannot contain wildcards (*). Wildcards are only supported in clear({ prefix: "pattern*" }).',
    )
  }
  const cacache = getCacache() as any
  return await cacache.get(getSocketCacacheDir(), key, options)
}

/**
 * Put data into the Socket shared cache with a key.
 *
 * @throws {TypeError} If key contains wildcards (*)
 */
export async function put(
  key: string,
  data: string | Buffer,
  options?: PutOptions | undefined,
) {
  if (key.includes('*')) {
    throw new TypeError(
      'Cache key cannot contain wildcards (*). Wildcards are only supported in clear({ prefix: "pattern*" }).',
    )
  }
  const cacache = getCacache()
  return await cacache.put(getSocketCacacheDir(), key, data, options)
}

/**
 * Remove an entry from the Socket shared cache by key.
 *
 * @throws {TypeError} If key contains wildcards (*)
 */
export async function remove(key: string): Promise<unknown> {
  if (key.includes('*')) {
    throw new TypeError(
      'Cache key cannot contain wildcards (*). Use clear({ prefix: "pattern*" }) to remove multiple entries.',
    )
  }
  const cacache = getCacache() as any
  return await cacache.rm.entry(getSocketCacacheDir(), key)
}

/**
 * Get data from the Socket shared cache by key without throwing.
 */
export async function safeGet(
  key: string,
  options?: GetOptions | undefined,
): Promise<CacheEntry | undefined> {
  try {
    return await get(key, options)
  } catch {
    return undefined
  }
}

/**
 * Execute a callback with a temporary directory for cache operations.
 */
export async function withTmp<T>(
  callback: (tmpDirPath: string) => Promise<T>,
): Promise<T> {
  const cacache = getCacache()
  // The DefinitelyTyped types for cacache.tmp.withTmp are incorrect.
  // It actually returns the callback's return value, not void.
  return (await cacache.tmp.withTmp(
    getSocketCacacheDir(),
    {},
    callback as any,
  )) as T
}
