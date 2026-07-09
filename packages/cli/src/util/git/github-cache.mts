/**
 * Persistent + in-memory response cache for GitHub API calls used by Socket
 * CLI. 5-minute TTL, automatic invalidation, and a persistent cache in
 * node_modules/.cache.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { LRUCache } from 'lru-cache'

import { readJson } from '@socketsecurity/lib-stable/fs/read-json'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { writeJson } from '@socketsecurity/lib-stable/fs/write-json'

import { DISABLE_GITHUB_CACHE } from '../../env/disable-github-cache.mts'
import { getGithubCachePath } from '../../constants/paths.mts'

import type { JsonContent } from '@socketsecurity/lib-stable/fs/types'

export interface CacheEntry {
  timestamp: number
  data: JsonContent
}

// In-memory promise cache to prevent concurrent fetches for the same key.
// LRU cache with max size to prevent unbounded memory growth.
const inflightRequests = new LRUCache<string, Promise<unknown>>({ max: 100 })

export async function cacheFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number | undefined,
): Promise<T> {
  /* c8 ignore start - DISABLE_GITHUB_CACHE not set in tests */
  if (DISABLE_GITHUB_CACHE) {
    return await fetcher()
  }
  /* c8 ignore stop */

  // Check if already fetching this key to prevent TOCTOU race.
  const inflight = inflightRequests.get(key)
  /* c8 ignore start - inflight cache hit requires concurrent calls; tests run serially */
  if (inflight) {
    return inflight as Promise<T>
  }
  /* c8 ignore stop */

  try {
    let data = (await readCache(key, ttlMs)) as T
    if (!data) {
      // Re-check inflight after async readCache to prevent race.
      const inflightAfterRead = inflightRequests.get(key)
      if (inflightAfterRead) {
        return inflightAfterRead as Promise<T>
      }

      const fetchPromise = (async () => {
        try {
          const result = await fetcher()
          await writeCache(key, result as JsonContent)
          return result
        } finally {
          inflightRequests.delete(key)
        }
      })()

      inflightRequests.set(key, fetchPromise)
      data = await fetchPromise
    }
    return data
  } catch (e) {
    // Fetch promise's finally block handles cleanup - no action needed here.
    throw e
  }
}

export async function readCache(
  key: string,
  // 5 minute in milliseconds time to live (TTL).
  ttlMs = 5 * 60 * 1000,
): Promise<JsonContent | undefined> {
  const githubCachePath = getGithubCachePath()
  const cacheJsonPath = path.join(githubCachePath, `${key}.json`)

  try {
    const entry = (await readJson(cacheJsonPath)) as CacheEntry | JsonContent
    // Handle both new format (with timestamp) and legacy format (without).
    if (
      entry &&
      typeof entry === 'object' &&
      'timestamp' in entry &&
      'data' in entry
    ) {
      const isExpired = Date.now() - (entry.timestamp as number) > ttlMs
      /* c8 ignore start - cache fresh-hit + legacy-format branches; tests pre-populate cache files in only one format */
      if (!isExpired) {
        return entry.data
      }
    } else {
      // Legacy format without timestamp - treat as expired.
      return undefined
    }
    /* c8 ignore stop */
  } catch {
    return undefined
  }
  return undefined
}

export async function writeCache(
  key: string,
  data: JsonContent,
): Promise<void> {
  const githubCachePath = getGithubCachePath()
  const cacheJsonPath = path.join(githubCachePath, `${key}.json`)
  // Create directory with recursive flag that doesn't fail if exists.
  await safeMkdir(githubCachePath, { recursive: true })

  const entry: CacheEntry = {
    timestamp: Date.now(),
    data,
  }

  // Use atomic write pattern to prevent multi-process race conditions.
  const tmpPath = `${cacheJsonPath}.tmp.${process.pid}`
  await writeJson(tmpPath, entry)
  await fs.rename(tmpPath, cacheJsonPath)
}
