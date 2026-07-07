// Cache for `gh api repos/<owner>/<repo>/commits/<sha>` lookups.
// Keyed by `<owner>/<repo>@<sha>`. 7-day TTL — a previously reachable
// SHA stays reachable for cache lifetime. Persisted to
// `~/.claude/uses-sha-verify-cache.json` so the cost doesn't repeat
// across sessions.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

export const CACHE_FILE = path.join(
  os.homedir(),
  '.claude',
  'uses-sha-verify-cache.json',
)
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// A NON-reachable result expires fast. A non-zero `gh` exit conflates a genuine
// 404 with a transient failure (timeout, rate-limit, 5xx); caching `false` the
// full 7 days would block a valid SHA pin for a week on one bad network moment.
// Ten minutes is long enough to avoid re-spamming `gh` for a truly-bad pin,
// short enough that a transient blip self-heals on the next invocation.
export const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export interface CacheEntry {
  reachable: boolean
  checkedAt: number
}

export interface Cache {
  entries: Record<string, CacheEntry>
}

export function loadCache(): Cache {
  if (!existsSync(CACHE_FILE)) {
    return { entries: {} }
  }
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      return { entries: {} }
    }
    return parsed
  } catch {
    return { entries: {} }
  }
}

export function saveCache(cache: Cache): void {
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8')
  } catch {
    // best-effort
  }
}

// Verify a commit SHA against `gh api repos/<owner>/<repo>/commits/<sha>`.
// Cached for 7 days; a previously-reachable SHA stays reachable.
export function verifyCommitSha(
  ownerRepo: string,
  sha: string,
  cache: Cache,
): boolean {
  const key = `${ownerRepo}@${sha}`
  const entry = cache.entries[key]
  if (entry) {
    // A reachable SHA is immutable, so it gets the full TTL; a non-reachable
    // result expires fast (see NEGATIVE_CACHE_TTL_MS) so a transient `gh`
    // failure can't block a valid pin for a week.
    const ttl = entry.reachable ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS
    if (Date.now() - entry.checkedAt < ttl) {
      return entry.reachable
    }
  }
  const result = spawnSync(
    'gh',
    ['api', `repos/${ownerRepo}/commits/${sha}`, '--silent'],
    { stdio: 'ignore', timeout: 5000 },
  )
  const reachable = result.status === 0
  cache.entries[key] = { reachable, checkedAt: Date.now() }
  return reachable
}
