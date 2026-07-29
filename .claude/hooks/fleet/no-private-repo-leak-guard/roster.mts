/*
 * @file Runtime private/public repository roster for `no-private-repo-leak-guard`.
 *
 *   The guard needs to know which repository names under an owner are PRIVATE.
 *   That set is resolved at RUNTIME from `gh repo list <owner> --json
 *   name,visibility` and never committed: a checked-in list of private repo
 *   names is itself the disclosure the guard exists to prevent — anyone reading
 *   the file gets the org's internal map for free.
 *
 *   Because a network round-trip per Bash tool call is untenable, the answer is
 *   memoized on disk under `~/.socket/_state/private-repo-roster.json` with a
 *   24-hour TTL. That store lives OUTSIDE any checkout (never a tracked tree,
 *   never a `.gitignore` entry to forget) and is written owner-only (0600) in an
 *   owner-only directory (0700). It must never be copied into a repo.
 *
 *   FAIL CLOSED. Every failure path — `gh` missing, unauthenticated, timed out,
 *   unparseable output, no fresh cache — returns `{ ok: false }`, and the guard
 *   BLOCKS on that. This is the deliberate inverse of the fleet's usual
 *   fail-open hook default: a leak guard that cannot verify the roster cannot
 *   certify the prose, and an unverifiable write to a public surface is exactly
 *   the case the guard is for. Do not "fix" this into a fail-open.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getHome } from '@socketsecurity/lib-stable/env/home'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * How long a cached roster stays authoritative, in milliseconds.
 */
export const ROSTER_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Upper bound on repositories fetched per owner. A `gh repo list` default of 30
 * would silently truncate a large org's roster into a false "not private".
 */
export const ROSTER_FETCH_LIMIT = 1000

/**
 * NETWORK spawn budget. Fixed, never platform-scaled — see
 * `_shared/spawn-timeout.mts`: a network timeout must stay bounded so a
 * blackout cannot hang the tool call.
 */
export const ROSTER_FETCH_TIMEOUT_MS = 10_000

/**
 * The resolved visibility split for one owner. Names are lowercased so every
 * comparison is case-insensitive, matching GitHub's own name resolution.
 */
export interface RepoRoster {
  readonly owner: string
  readonly privateNames: ReadonlySet<string>
  readonly publicNames: ReadonlySet<string>
}

/**
 * A roster lookup either resolved, or failed with a reason the block message
 * shows the operator. There is no third "unknown but proceed" state — that is
 * what fail-closed means.
 */
export type RosterLookup =
  | { readonly ok: true; readonly roster: RepoRoster }
  | { readonly ok: false; readonly owner: string; readonly reason: string }

/**
 * Resolve one owner's roster. Injected by the guard's tests so no spec ever
 * reaches the network.
 */
export type RosterResolver = (owner: string) => RosterLookup

interface CachedOwner {
  readonly fetchedAt: number
  readonly privateNames: readonly string[]
  readonly publicNames: readonly string[]
}

interface RosterCacheFile {
  readonly version: number
  readonly owners: Record<string, CachedOwner>
}

const CACHE_VERSION = 1

// GitHub reports three visibilities. INTERNAL means "visible to the enterprise
// only" — not public, so it counts as private for leak purposes.
const NON_PUBLIC_VISIBILITIES: ReadonlySet<string> = new Set([
  'INTERNAL',
  'PRIVATE',
])

/**
 * Absolute path of the on-disk roster store. One file for every owner, per the
 * fleet's consolidate-runtime-state rule — not a marker per owner.
 */
export function rosterCachePath(
  home: string = getHome() ?? os.homedir(),
): string {
  return path.join(home, '.socket', '_state', 'private-repo-roster.json')
}

/**
 * Parse `gh repo list --json name,visibility` output into a roster. Returns
 * undefined when the payload is not the expected array-of-objects shape, which
 * the caller turns into a fail-closed lookup.
 */
export function parseRosterJson(
  owner: string,
  json: string,
): RepoRoster | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) {
    return undefined
  }
  const privateNames = new Set<string>()
  const publicNames = new Set<string>()
  for (let i = 0, { length } = parsed; i < length; i += 1) {
    const entry = parsed[i] as
      | { name?: unknown | undefined; visibility?: unknown | undefined }
      | undefined
    if (!entry || typeof entry.name !== 'string' || !entry.name) {
      return undefined
    }
    const visibility =
      typeof entry.visibility === 'string' ? entry.visibility.toUpperCase() : ''
    if (!visibility) {
      return undefined
    }
    const name = entry.name.toLowerCase()
    if (NON_PUBLIC_VISIBILITIES.has(visibility)) {
      privateNames.add(name)
    } else {
      publicNames.add(name)
    }
  }
  return { owner: owner.toLowerCase(), privateNames, publicNames }
}

function readCacheFile(cachePath: string): RosterCacheFile | undefined {
  let raw: string
  try {
    raw = readFileSync(cachePath, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const file = parsed as Partial<RosterCacheFile>
  if (file.version !== CACHE_VERSION || !file.owners) {
    return undefined
  }
  return { owners: file.owners, version: CACHE_VERSION }
}

/**
 * The cached roster for `owner` when it exists and is younger than the TTL.
 * A stale entry is treated as absent so the guard refetches rather than
 * certifying prose against a day-old view of the org.
 */
export function readCachedRoster(
  owner: string,
  now: number,
  cachePath: string,
): RepoRoster | undefined {
  const file = readCacheFile(cachePath)
  const entry = file?.owners[owner.toLowerCase()]
  if (
    !entry ||
    typeof entry.fetchedAt !== 'number' ||
    !Array.isArray(entry.privateNames) ||
    !Array.isArray(entry.publicNames) ||
    now - entry.fetchedAt >= ROSTER_TTL_MS
  ) {
    return undefined
  }
  return {
    owner: owner.toLowerCase(),
    privateNames: new Set(entry.privateNames),
    publicNames: new Set(entry.publicNames),
  }
}

/**
 * Merge `roster` into the on-disk store. Best-effort: a write failure costs a
 * refetch next call, never the verdict.
 */
export function writeCachedRoster(
  roster: RepoRoster,
  now: number,
  cachePath: string,
): void {
  try {
    mkdirSync(path.dirname(cachePath), { mode: 0o700, recursive: true })
    const existing = readCacheFile(cachePath)
    const owners: Record<string, CachedOwner> = { ...existing?.owners }
    owners[roster.owner] = {
      fetchedAt: now,
      privateNames: [...roster.privateNames].toSorted(),
      publicNames: [...roster.publicNames].toSorted(),
    }
    writeFileSync(
      cachePath,
      `${JSON.stringify({ owners, version: CACHE_VERSION }, undefined, 2)}\n`,
      { mode: 0o600 },
    )
  } catch {
    // A cache write never gates the verdict.
  }
}

/**
 * Query GitHub for one owner's roster. Returns undefined on any failure so the
 * caller fails closed with a reason.
 */
export function fetchRosterFromGh(owner: string): RepoRoster | undefined {
  let result: ReturnType<typeof spawnSync>
  try {
    result = spawnSync(
      'gh',
      [
        'repo',
        'list',
        owner,
        '--json',
        'name,visibility',
        '--limit',
        String(ROSTER_FETCH_LIMIT),
      ],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        stdioString: true,
        timeout: ROSTER_FETCH_TIMEOUT_MS,
      },
    )
  } catch {
    return undefined
  }
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return undefined
  }
  return parseRosterJson(owner, result.stdout)
}

export interface RosterResolveOptions {
  readonly cachePath?: string | undefined
  readonly fetchRoster?: ((owner: string) => RepoRoster | undefined) | undefined
  readonly now?: number | undefined
}

/**
 * Cache-then-fetch roster resolution for one owner, memoized per process so a
 * command naming several repos under one owner costs at most one lookup.
 */
export function resolveRepoRoster(
  owner: string,
  options?: RosterResolveOptions | undefined,
): RosterLookup {
  const opts = { __proto__: null, ...options } as RosterResolveOptions
  const key = owner.toLowerCase()
  if (!key) {
    return { ok: false, owner, reason: 'no repository owner to resolve' }
  }
  const now = opts.now ?? Date.now()
  const cachePath = opts.cachePath ?? rosterCachePath()
  const fetchRoster = opts.fetchRoster ?? fetchRosterFromGh
  const cached = readCachedRoster(key, now, cachePath)
  if (cached) {
    return { ok: true, roster: cached }
  }
  let fetched: RepoRoster | undefined
  try {
    fetched = fetchRoster(key)
  } catch (e) {
    return {
      ok: false,
      owner: key,
      reason: `\`gh repo list ${key}\` threw: ${errorMessage(e)}`,
    }
  }
  if (!fetched) {
    return {
      ok: false,
      owner: key,
      reason: `\`gh repo list ${key} --json name,visibility\` returned no usable roster (gh missing, unauthenticated, offline, or unparseable output)`,
    }
  }
  writeCachedRoster(fetched, now, cachePath)
  return { ok: true, roster: fetched }
}

/**
 * A process-lifetime memoizing wrapper around {@link resolveRepoRoster}. One
 * dispatcher process handles one tool call, so the memo's scope is that call.
 */
export function createRepoRosterResolver(
  options?: RosterResolveOptions | undefined,
): RosterResolver {
  const memo = new Map<string, RosterLookup>()
  return (owner: string) => {
    const key = owner.toLowerCase()
    const hit = memo.get(key)
    if (hit) {
      return hit
    }
    const lookup = resolveRepoRoster(key, options)
    memo.set(key, lookup)
    return lookup
  }
}
