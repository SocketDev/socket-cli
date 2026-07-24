/**
 * @file The single fleet helper for "what date did `<pkg>@<version>` publish?".
 *   Reads the canonical registry's packument `time` map via `httpJson` (socket-
 *   lib — the fleet "never bare `fetch()`" rule; only the dep-0 bootstrap goes
 *   bare). Lean on purpose: the soak-exclude verification + soak-bypass import
 *   THIS, not publish-infra/ (which also pulls the publish/spawn machinery).
 *   Persisted for `CACHE_TTL_MS` (24h) via `createTtlCache` — the same
 *   cacache-backed primitive `check-new-deps/audit.mts` uses for its 404
 *   counter. A publish date never changes once npm records it, so re-pinging
 *   the registry for the same `name@version` on every `pnpm run check` / `fix
 *   --all` invocation is wasted round-trips: `fleet-soak-exclude-parity.mts`
 *   re-verifies every still-soaking pin's publish date on EVERY check run,
 *   which stalled `pnpm run fix --all` behind a slow/throttled registry. The
 *   cache absorbs repeat runs within the same day; `getOrFetch` also
 *   thundering-herd-dedupes concurrent lookups for the same key within one
 *   process. FAIL-OPEN — a slow/unreachable registry yields `undefined`,
 *   never a throw, so offline CI / firewall warmup never blocks or false-reds
 *   a caller. A failed lookup is NEVER persisted: `TtlCache.get` cannot tell a
 *   cached `undefined` apart from a genuine miss, so the next call always
 *   retries the network rather than being stuck on a false negative for the
 *   full TTL window.
 */

import { createTtlCache } from '@socketsecurity/lib-stable/cache/ttl/store'
import type {
  TtlCache,
  TtlCacheOptions,
} from '@socketsecurity/lib-stable/cache/ttl/types'
import { httpJson } from '@socketsecurity/lib-stable/http-request'

import { NPM_REGISTRY_URL } from './constants/npm-registry.mts'

// Publish dates never change once npm records them — the 24h TTL is purely
// about not re-hitting the registry every run, not about data freshness.
const CACHE_PREFIX = 'registry-publish-date'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
// Bounded per-attempt timeout so an unreachable/slow registry can't stall a
// caller (doctor / fix / check) indefinitely; two attempts absorb one
// transient blip.
const FETCH_TIMEOUT_MS = 10_000

let defaultCache: TtlCache | undefined

/**
 * Create a dedicated publish-date cache instance — same prefix/TTL as the
 * module default, overridable per-call. Use this (vs. the default singleton)
 * for test isolation.
 */
export function createRegistryPublishDateCache(
  options?: TtlCacheOptions | undefined,
): TtlCache {
  const opts = { __proto__: null, ...options } as TtlCacheOptions
  return createTtlCache({
    prefix: CACHE_PREFIX,
    ttl: CACHE_TTL_MS,
    ...opts,
  })
}

// Lazily built because createTtlCache touches cacache on disk and we don't
// want that work paid by a caller that never fetches anything.
function getDefaultRegistryPublishDateCache(): TtlCache {
  if (!defaultCache) {
    defaultCache = createRegistryPublishDateCache()
  }
  return defaultCache
}

/**
 * Fetch the ISO publish date (`YYYY-MM-DD`) of `name@version` from the
 * canonical registry's packument `time` map. Returns the date, or `undefined`
 * on any failure (network error, unknown version, parse). `FETCH_TIMEOUT_MS`
 * timeout + one retry for a transient blip. Persisted for `CACHE_TTL_MS` (24h)
 * via `cache` (the shared cacache-backed singleton, or an injected instance
 * for test isolation) — a hit within the window skips the network call
 * entirely. Fail-open: callers must treat `undefined` as "couldn't verify",
 * never as a failure (so an unreachable registry can't block a soak decision
 * or red a check); a failed lookup is never persisted, so it retries fresh on
 * the next call rather than being stuck on a false negative for the full TTL.
 */
export function fetchPackagePublishDate(
  name: string,
  version: string,
  cache: TtlCache = getDefaultRegistryPublishDateCache(),
): Promise<string | undefined> {
  const key = `${name}@${version}`
  return cache.getOrFetch(key, async (): Promise<string | undefined> => {
    const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const data = await httpJson<{
          time?: Record<string, unknown> | undefined
        }>(url, {
          headers: { accept: 'application/json' },
          timeout: FETCH_TIMEOUT_MS,
        })
        const stamp = data?.time?.[version]
        // 200 but no `time` entry for this version → definitive, don't retry.
        return typeof stamp === 'string' ? stamp.slice(0, 10) : undefined
      } catch {
        // Transient (timeout / network) — retry once, then give up fail-open.
      }
    }
    return undefined
  })
}
