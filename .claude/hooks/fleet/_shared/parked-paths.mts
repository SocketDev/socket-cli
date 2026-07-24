/*
 * @file Parked-paths ledger — the user-intent HOLD for the landing machinery.
 *   When the user says hold/park/wait on a path, the agent records it here
 *   (via auto-land-on-stop/hold.mts); auto-land-on-stop then EXCLUDES parked
 *   paths from landing and dirty-worktree-stop-guard treats them as
 *   sanctioned-dirty instead of re-blocking every turn. One checkout-scoped
 *   file (not per-actor): parking states an intent about the PATH, so it holds
 *   for every session sharing the checkout. Storage follows the runtime-state
 *   rule: `node_modules/.cache/fleet/socket-parked-paths/parked.json`, falling back
 *   to OS temp when node_modules is unavailable. Entries expire after
 *   PARKED_TTL_MS (a parked path is a short-lived instruction, not config) and
 *   are cleared explicitly on the user's next go-ahead. Every reader
 *   fail-opens to "nothing parked" — a broken ledger must not wedge Stop.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Generous by hook standards: a park typically waits on a doc/decision that
// arrives within a working day. Re-park to extend.
export const PARKED_TTL_MS = 24 * 60 * 60 * 1000

// Last-resort fallback when a caller passes no projectDir and the agent
// runner hasn't set CLAUDE_PROJECT_DIR: walk up from this file's own location
// (`.claude/hooks/fleet/_shared/`) to the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FALLBACK_PROJECT_DIR = path.join(HERE, '..', '..', '..', '..')

export interface ParkedEntry {
  readonly note?: string | undefined
  readonly parkedAt: number
  readonly path: string
}

/**
 * Absolute path of the parked ledger for a checkout. Prefers
 * `<projectDir>/node_modules/.cache/fleet/socket-parked-paths/parked.json`
 * (dep-0 runtime state, never tracked); falls back to a checkout-keyed file
 * under OS temp when node_modules doesn't exist yet.
 */
export function resolveParkedFile(projectDir: string | undefined): string {
  const base =
    projectDir ?? process.env['CLAUDE_PROJECT_DIR'] ?? FALLBACK_PROJECT_DIR
  const cacheDir = path.join(base, 'node_modules', '.cache')
  if (existsSync(path.join(base, 'node_modules'))) {
    return path.join(cacheDir, 'fleet', 'socket-parked-paths', 'parked.json')
  }
  const key = base.replace(/[^A-Za-z0-9]+/g, '-')
  return path.join(os.tmpdir(), 'socket-parked-paths', `${key}.json`)
}

/**
 * Read the ledger, pruning expired entries. Fail-open: missing file, IO error,
 * or malformed JSON all read as "nothing parked".
 */
export function readParked(
  filePath: string,
  config: { now: number },
): ParkedEntry[] {
  const cfg = { __proto__: null, ...config } as { now: number }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as { entries?: unknown | undefined }).entries)
  ) {
    return []
  }
  const out: ParkedEntry[] = []
  for (const e of (raw as { entries: unknown[] }).entries) {
    if (!e || typeof e !== 'object') {
      continue
    }
    const entry = e as Record<string, unknown>
    if (
      typeof entry['path'] !== 'string' ||
      typeof entry['parkedAt'] !== 'number'
    ) {
      continue
    }
    if (cfg.now - entry['parkedAt'] > PARKED_TTL_MS) {
      continue
    }
    out.push({
      note: typeof entry['note'] === 'string' ? entry['note'] : undefined,
      parkedAt: entry['parkedAt'],
      path: entry['path'],
    })
  }
  return out
}

export function writeParked(
  filePath: string,
  entries: readonly ParkedEntry[],
): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify({ entries }, undefined, 2)}\n`)
}

/**
 * Park absolute paths (re-parking an already-parked path refreshes its
 * timestamp/note). Returns the new entry list.
 */
export function parkPaths(
  filePath: string,
  absPaths: readonly string[],
  config: { note?: string | undefined; now: number },
): ParkedEntry[] {
  const cfg = { __proto__: null, ...config } as {
    note?: string | undefined
    now: number
  }
  const existing = readParked(filePath, { now: cfg.now })
  const incoming = new Set(absPaths.map(p => path.resolve(p)))
  const kept = existing.filter(e => !incoming.has(e.path))
  for (const abs of incoming) {
    kept.push({ note: cfg.note, parkedAt: cfg.now, path: abs })
  }
  writeParked(filePath, kept)
  return kept
}

/**
 * Clear specific parked paths, or everything when `absPaths` is undefined.
 * Returns the remaining entries.
 */
export function clearParked(
  filePath: string,
  absPaths: readonly string[] | undefined,
  config: { now: number },
): ParkedEntry[] {
  const cfg = { __proto__: null, ...config } as { now: number }
  if (!absPaths) {
    writeParked(filePath, [])
    return []
  }
  const removing = new Set(absPaths.map(p => path.resolve(p)))
  const kept = readParked(filePath, { now: cfg.now }).filter(
    e => !removing.has(e.path),
  )
  writeParked(filePath, kept)
  return kept
}

/**
 * Is an absolute path covered by a parked entry? A parked directory holds its
 * whole subtree.
 */
export function isParked(
  abs: string,
  entries: readonly ParkedEntry[],
): boolean {
  const resolved = path.resolve(abs)
  return entries.some(
    e => resolved === e.path || resolved.startsWith(e.path + path.sep),
  )
}
