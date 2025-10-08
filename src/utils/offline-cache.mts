/** @fileoverview Offline mode and intelligent caching for Socket CLI. */

import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

interface CacheEntry<T = any> {
  data: T
  timestamp: number
  ttl: number
  etag?: string
  metadata?: Record<string, any>
}

interface CacheOptions {
  ttl?: number  // Time to live in milliseconds
  offline?: boolean  // Force offline mode
  refresh?: boolean  // Force refresh even if cached
  namespace?: string  // Cache namespace for organization
}

const CACHE_DIR = join(homedir(), '.socket', '_cacache')
const CACHE_METADATA_FILE = 'cache-metadata.json'

/**
 * Get cache key for a given operation
 */
function getCacheKey(operation: string, params: any): string {
  const normalized = JSON.stringify(params, Object.keys(params).sort())
  const hash = crypto.createHash('sha256').update(normalized).digest('hex')
  return `${operation}-${hash.slice(0, 16)}`
}

/**
 * Get cache file path
 */
async function getCachePath(namespace: string, key: string): Promise<string> {
  const dir = join(CACHE_DIR, namespace)
  await mkdir(dir, { recursive: true })
  return join(dir, `${key}.json`)
}

/**
 * Read from cache
 */
async function readFromCache<T>(
  namespace: string,
  key: string,
): Promise<CacheEntry<T> | null> {
  try {
    const path = await getCachePath(namespace, key)
    if (!existsSync(path)) {
      return null
    }

    const content = await readFile(path, 'utf8')
    const entry = JSON.parse(content) as CacheEntry<T>

    // Check if expired
    const now = Date.now()
    if (entry.ttl > 0 && now - entry.timestamp > entry.ttl) {
      return null  // Expired
    }

    return entry
  } catch {
    return null
  }
}

/**
 * Write to cache
 */
async function writeToCache<T>(
  namespace: string,
  key: string,
  data: T,
  options: CacheOptions = {},
): Promise<void> {
  try {
    const path = await getCachePath(namespace, key)
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: options.ttl || 3600000, // Default 1 hour
      metadata: options.namespace ? { namespace: options.namespace } : undefined,
    }

    await writeFile(path, JSON.stringify(entry, null, 2))
  } catch (error) {
    // Silently fail cache writes
  }
}

/**
 * Cache-aware API call wrapper
 */
export async function withCache<T>(
  operation: string,
  params: any,
  fetcher: () => Promise<T>,
  options: CacheOptions = {},
): Promise<T> {
  const namespace = options.namespace || 'default'
  const key = getCacheKey(operation, params)

  // Check if we should use offline mode
  const isOffline = options.offline || process.env['SOCKET_OFFLINE'] === '1'

  // Try to read from cache first
  if (!options.refresh) {
    const cached = await readFromCache<T>(namespace, key)
    if (cached) {
      const age = Date.now() - cached.timestamp
      const ageStr = formatAge(age)

      if (isOffline) {
        logger.info(`📦 Using cached data (offline mode, ${ageStr} old)`)
        return cached.data
      }

      // If not expired, use cached data
      if (cached.ttl === 0 || age < cached.ttl) {
        if (process.env['SOCKET_VERBOSE']) {
          logger.info(`📦 Using cached data (${ageStr} old)`)
        }
        return cached.data
      }

      // If expired but in offline mode, still use it
      if (isOffline) {
        logger.warn(`⚠️  Using expired cache (offline mode, ${ageStr} old)`)
        return cached.data
      }
    } else if (isOffline) {
      throw new Error('No cached data available in offline mode')
    }
  }

  // Fetch fresh data
  try {
    const data = await fetcher()

    // Cache the result
    await writeToCache(namespace, key, data, options)

    return data
  } catch (error) {
    // If fetch fails, try to use stale cache
    const cached = await readFromCache<T>(namespace, key)
    if (cached) {
      const age = Date.now() - cached.timestamp
      logger.warn(`⚠️  Using stale cache due to fetch error (${formatAge(age)} old)`)
      return cached.data
    }

    throw error
  }
}

/**
 * Format age for display
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {return `${days}d`}
  if (hours > 0) {return `${hours}h`}
  if (minutes > 0) {return `${minutes}m`}
  return `${seconds}s`
}

/**
 * Clear cache for a namespace or entirely
 */
export async function clearCache(namespace?: string): Promise<void> {
  if (namespace) {
    const dir = join(CACHE_DIR, namespace)
    if (existsSync(dir)) {
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true })
      logger.success(`✓ Cleared cache for ${namespace}`)
    }
  } else {
    if (existsSync(CACHE_DIR)) {
      const { rm } = await import('node:fs/promises')
      await rm(CACHE_DIR, { recursive: true })
      logger.success('✓ Cleared all cache')
    }
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  size: number
  entries: number
  namespaces: string[]
  oldest?: Date
  newest?: Date
}> {
  const stats = {
    size: 0,
    entries: 0,
    namespaces: [] as string[],
    oldest: undefined as Date | undefined,
    newest: undefined as Date | undefined,
  }

  if (!existsSync(CACHE_DIR)) {
    return stats
  }

  const { readdir, stat } = await import('node:fs/promises')

  try {
    const namespaces = await readdir(CACHE_DIR)
    stats.namespaces = namespaces

    let oldestTime = Infinity
    let newestTime = 0

    for (const ns of namespaces) {
      const nsPath = join(CACHE_DIR, ns)
      const files = await readdir(nsPath)

      for (const file of files) {
        if (file.endsWith('.json')) {
          stats.entries++
          const filePath = join(nsPath, file)
          const fileStat = await stat(filePath)
          stats.size += fileStat.size

          const mtime = fileStat.mtime.getTime()
          if (mtime < oldestTime) {oldestTime = mtime}
          if (mtime > newestTime) {newestTime = mtime}
        }
      }
    }

    if (oldestTime !== Infinity) {stats.oldest = new Date(oldestTime)}
    if (newestTime !== 0) {stats.newest = new Date(newestTime)}
  } catch {
    // Ignore errors
  }

  return stats
}

/**
 * Smart cache warming - pre-fetch commonly used data
 */
export async function warmCache(
  operations: Array<{ operation: string; params: any; fetcher: () => Promise<any> }>,
  options: CacheOptions = {},
): Promise<void> {
  logger.info('🔥 Warming cache...')

  const results = await Promise.allSettled(
    operations.map(({ fetcher, operation, params }) =>
      withCache(operation, params, fetcher, { ...options, refresh: true }),
    ),
  )

  const successful = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length

  logger.success(`✓ Cache warmed: ${successful} succeeded, ${failed} failed`)
}

/**
 * Offline mode detector
 */
export function isOfflineMode(): boolean {
  return process.env['SOCKET_OFFLINE'] === '1'
}

/**
 * Set offline mode
 */
export function setOfflineMode(enabled: boolean): void {
  if (enabled) {
    process.env['SOCKET_OFFLINE'] = '1'
    logger.info('📴 Offline mode enabled')
  } else {
    delete process.env['SOCKET_OFFLINE']
    logger.info('📶 Online mode enabled')
  }
}