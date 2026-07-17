/**
 * @file The single fleet helper for "what date did `<pkg>@<version>` publish?".
 *   Reads the canonical registry's packument `time` map via `httpJson` (socket-
 *   lib — the fleet "never bare `fetch()`" rule; only the dep-0 bootstrap goes
 *   bare). Lean on purpose: the soak-exclude verification + soak-bypass import
 *   THIS, not publish-infra/ (which also pulls the publish/spawn
 *   machinery). FAIL-OPEN — a slow/unreachable registry yields `undefined`,
 *   never a throw, so offline CI / firewall warmup never blocks or false-reds a
 *   caller.
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'

import { NPM_REGISTRY_URL } from './constants/npm-registry.mts'

// Run-scoped memo, keyed by `name@version` — one registry request per distinct
// package@version per process, even across a fan-out.
const publishDateCache = new Map<string, Promise<string | undefined>>()

/**
 * Fetch the ISO publish date (`YYYY-MM-DD`) of `name@version` from the
 * canonical registry's packument `time` map. Returns the date, or `undefined`
 * on any failure (network error, unknown version, parse). 15s timeout + one
 * retry for a transient blip; memoized per `name@version`. Fail-open: callers
 * must treat `undefined` as "couldn't verify", never as a failure (so an
 * unreachable registry can't block a soak decision or red a check).
 */
export function fetchPackagePublishDate(
  name: string,
  version: string,
): Promise<string | undefined> {
  const key = `${name}@${version}`
  const cached = publishDateCache.get(key)
  if (cached) {
    return cached
  }
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  const promise = (async (): Promise<string | undefined> => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const data = await httpJson<{
          time?: Record<string, unknown> | undefined
        }>(url, { headers: { accept: 'application/json' }, timeout: 15_000 })
        const stamp = data?.time?.[version]
        // 200 but no `time` entry for this version → definitive, don't retry.
        return typeof stamp === 'string' ? stamp.slice(0, 10) : undefined
      } catch {
        // Transient (timeout / network) — retry once, then give up fail-open.
      }
    }
    return undefined
  })()
  publishDateCache.set(key, promise)
  return promise
}
