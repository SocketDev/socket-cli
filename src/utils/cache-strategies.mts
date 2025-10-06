/** @fileoverview Intelligent caching strategies for Socket CLI API responses. Provides cache warming, invalidation, and adaptive TTL based on data volatility. */

import { debugCache } from './debug.mts'
import { getDefaultCacheTtl } from './sdk.mts'

import type { SocketSdk } from '@socketsecurity/sdk'

/**
 * Cache strategy configuration for different API endpoints.
 */
type CacheStrategy = {
  /** Base TTL in milliseconds */
  ttl: number
  /** Whether to warm this cache on startup */
  warmOnStartup?: boolean
  /** Whether this data changes frequently */
  volatile?: boolean
  /** Cache key pattern (for invalidation) */
  pattern?: string
}

/**
 * Predefined cache strategies for common API endpoints.
 * Optimizes cache behavior based on data characteristics.
 */
const CACHE_STRATEGIES: Record<string, CacheStrategy> = {
  // Package metadata - relatively stable, cache longer
  'package-info': {
    // 15 minutes
    ttl: 15 * 60 * 1000,
    warmOnStartup: false,
    volatile: false,
    pattern: '/npm/*/*/score',
  },

  // Package scores - updated periodically, medium TTL
  'package-scores': {
    // 10 minutes
    ttl: 10 * 60 * 1000,
    warmOnStartup: false,
    volatile: false,
    pattern: '/npm/*/*/score',
  },

  // Issue data - can change with new scans, shorter TTL
  'package-issues': {
    // 5 minutes
    ttl: 5 * 60 * 1000,
    warmOnStartup: false,
    volatile: true,
    pattern: '/npm/*/*/issues',
  },

  // Scan results - volatile during active development
  'scan-results': {
    // 2 minutes
    ttl: 2 * 60 * 1000,
    warmOnStartup: false,
    volatile: true,
    pattern: '/scans/*',
  },

  // Organization settings - stable, cache longer
  'org-settings': {
    // 30 minutes
    ttl: 30 * 60 * 1000,
    warmOnStartup: true,
    volatile: false,
    pattern: '/organizations/*/settings',
  },

  // User info - very stable, cache longest
  'user-info': {
    // 1 hour
    ttl: 60 * 60 * 1000,
    warmOnStartup: true,
    volatile: false,
    pattern: '/users/*',
  },

  // Repository list - moderately stable
  'repo-list': {
    // 10 minutes
    ttl: 10 * 60 * 1000,
    warmOnStartup: false,
    volatile: false,
    pattern: '/repositories',
  },

  // Dependency tree - stable for a given package version
  'dependency-tree': {
    // 30 minutes
    ttl: 30 * 60 * 1000,
    warmOnStartup: false,
    volatile: false,
    pattern: '/dependencies/*',
  },
}

/**
 * Get cache strategy for a given API path.
 * Returns default strategy if no specific strategy defined.
 */
export function getCacheStrategy(path: string): CacheStrategy {
  // Try exact match first
  for (const [_key, strategy] of Object.entries(CACHE_STRATEGIES)) {
    if (strategy.pattern && matchesPattern(path, strategy.pattern)) {
      debugCache('hit', `strategy:${_key}`, { path, ttl: strategy.ttl })
      return strategy
    }
  }

  // Return default strategy
  const defaultTtl = getDefaultCacheTtl()
  debugCache('miss', 'strategy:default', { path, ttl: defaultTtl })
  return {
    ttl: defaultTtl,
    warmOnStartup: false,
    volatile: false,
  }
}

/**
 * Check if a path matches a cache pattern.
 * Supports simple glob-style patterns with *.
 */
function matchesPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    // * matches non-slash chars
    .replaceAll(/\*/g, '[^/]+')
    // Escape forward slashes
    .replaceAll(/\//g, '\\/')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(path)
}

/**
 * Get recommended TTL for a specific API path.
 * Uses intelligent caching strategies based on data volatility.
 */
export function getRecommendedTtl(path: string): number {
  const strategy = getCacheStrategy(path)
  return strategy.ttl
}

/**
 * Check if a path should be warmed on startup.
 * Critical paths like user info and org settings benefit from warming.
 */
export function shouldWarmCache(path: string): boolean {
  const strategy = getCacheStrategy(path)
  return strategy.warmOnStartup || false
}

/**
 * Check if data at path is volatile (changes frequently).
 * Volatile data may warrant more aggressive cache invalidation.
 */
export function isVolatileData(path: string): boolean {
  const strategy = getCacheStrategy(path)
  return strategy.volatile || false
}

/**
 * Warm critical caches by pre-fetching commonly used data.
 * Call this on CLI startup to improve initial response times.
 *
 * @example
 * const sdk = await setupSdk()
 * await warmCaches(sdk.data, ['/users/me', '/organizations/my-org/settings'])
 */
export async function warmCaches(
  sdk: SocketSdk,
  paths: string[],
): Promise<void> {
  debugCache('set', 'warming', { count: paths.length })

  const warmPromises = paths.filter(shouldWarmCache).map(async path => {
    try {
      await sdk.getApi(path, { responseType: 'json' })
      debugCache('set', `warmed:${path}`)
    } catch (error) {
      debugCache('miss', `warm-failed:${path}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      })
    }
  })

  await Promise.all(warmPromises)
}

/**
 * Invalidate caches matching a pattern.
 * Useful after mutations to ensure fresh data on next fetch.
 *
 * Note: This requires SDK support for cache invalidation.
 * Currently a no-op pending SDK cache API enhancement.
 */
export function invalidateCachePattern(_pattern: string): void {
  debugCache('clear', `pattern:${_pattern}`)
  // TODO: Implement when SDK exposes cache invalidation API
  // For now, caches auto-expire based on TTL
}

/**
 * Calculate adaptive TTL based on request frequency.
 * Frequently accessed data gets shorter TTL to ensure freshness.
 *
 * @param baseT tl - Base TTL from strategy
 * @param accessCount - Number of times accessed in current session
 * @returns Adjusted TTL in milliseconds
 */
export function calculateAdaptiveTtl(
  baseTtl: number,
  accessCount: number,
): number {
  // Reduce TTL for frequently accessed volatile data
  // 30 seconds minimum
  const MIN_TTL = 30 * 1000
  const MAX_ACCESSES = 10

  if (accessCount > MAX_ACCESSES) {
    // Frequently accessed - reduce TTL by up to 50%
    const reduction = Math.min(0.5, (accessCount - MAX_ACCESSES) / 20)
    const adjustedTtl = Math.max(MIN_TTL, baseTtl * (1 - reduction))
    return Math.round(adjustedTtl)
  }

  return baseTtl
}
