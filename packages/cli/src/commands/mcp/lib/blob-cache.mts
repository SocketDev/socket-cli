/**
 * Process-wide LRU cache of fetched blobs, keyed by content-addressed hash.
 *
 * A blob is immutable for its hash, so caching needs no invalidation. Repeated
 * reads and greps of the same file inside one session skip the network, and
 * concurrent misses for one hash share a single in-flight fetch.
 */

import { fetchSocketBlob } from './blob.mts'

import type { BlobResult } from './blob.mts'

// The cache lives inside a developer's CLI process, not a server, so the cap is
// sized for a working set of a few files rather than a shared workload.
export const BLOB_CACHE_MAX_BYTES = 16 * 1024 * 1024

const cache = new Map<string, BlobResult>()
const inFlight = new Map<string, Promise<BlobResult>>()
let cacheBytes = 0

/**
 * Weigh an entry by UTF-8 byte length rather than UTF-16 `.length` so the cap
 * holds for multibyte text, plus fixed overhead so a binary entry (empty text)
 * still occupies a slot.
 */
export function blobCacheWeight(blob: BlobResult): number {
  return Buffer.byteLength(blob.text, 'utf8') + 512
}

export function evictBlobCache(): void {
  while (cacheBytes > BLOB_CACHE_MAX_BYTES && cache.size > 0) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) {
      break
    }
    const victim = cache.get(oldest)
    cache.delete(oldest)
    if (victim) {
      cacheBytes = Math.max(0, cacheBytes - blobCacheWeight(victim))
    }
  }
}

export async function getOrFetchSocketBlob(hash: string): Promise<BlobResult> {
  const cached = cache.get(hash)
  if (cached) {
    // LRU bump: re-insert so this entry moves to the end of iteration order.
    cache.delete(hash)
    cache.set(hash, cached)
    return cached
  }
  const pending = inFlight.get(hash)
  if (pending) {
    return await pending
  }
  const fetchPromise = (async () => {
    try {
      const blob = await fetchSocketBlob(hash)
      const weight = blobCacheWeight(blob)
      // A blob larger than the whole cache is returned but never stored, so the
      // cap invariant holds.
      if (weight <= BLOB_CACHE_MAX_BYTES) {
        cache.set(hash, blob)
        cacheBytes += weight
        evictBlobCache()
      }
      return blob
    } finally {
      inFlight.delete(hash)
    }
  })()
  inFlight.set(hash, fetchPromise)
  return await fetchPromise
}

/**
 * Drop every cached entry. Exists so tests start from a known state.
 */
export function resetBlobCache(): void {
  cache.clear()
  inFlight.clear()
  cacheBytes = 0
}
