// Fleet check — nudge/guard duplication.
//
// Fleet convention (CLAUDE.md hook naming): a `-guard` hook BLOCKS, a
// `-nudge` hook NUDGES. One surface per concern — never both a `-guard`
// and a `-nudge` for the same thing. Duplication has crept in before (a
// prose-antipattern nudge overlapping its guard) and was resolved by dropping
// the nudge in favor of the hard guard. This check stops it from recurring.
//
// ERROR: a base name has BOTH `<base>-guard` and `<base>-nudge`. That is an
// exact same-concern duplicate — collapse to one (prefer the guard).
//
// ADVISORY: two hooks share a leading name segment but differ after it (e.g.
// `ai-config-poisoning-guard` + `ai-config-drift-nudge`, or
// `parallel-agent-edit-guard` + `parallel-agent-on-stop-nudge`). These MAY
// be distinct facets or a latent duplicate — the check cannot tell semantic
// overlap from a shared prefix, so it lists them for a human glance without
// failing.
//
// Usage: node scripts/fleet/check/hooks-have-no-guard-nudge-overlap.mts [--quiet]

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface OverlapReport {
  exactCollisions: string[]
  prefixPairs: Array<{ guard: string; nudge: string; prefix: string }>
}

/**
 * List the immediate `<name>` hook directories under a fleet hooks dir. Returns
 * an empty array when the dir is absent (a repo with no hooks).
 */
export function listHookNames(hooksDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(hooksDir)
  } catch {
    return []
  }
  const names: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    // Skip shared utilities + dotfiles; only real hook dirs.
    if (name === '_shared' || name.startsWith('.')) {
      continue
    }
    try {
      if (statSync(path.join(hooksDir, name)).isDirectory()) {
        names.push(name)
      }
    } catch {}
  }
  return names
}

/**
 * Count the leading `-`-delimited segments two names share.
 * `['claude','md','size']` vs `['claude','md','prefer',…]` → 2.
 */
export function sharedPrefixSegments(
  a: readonly string[],
  b: readonly string[],
): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) {
    i += 1
  }
  return i
}

/**
 * Classify hook names into nudge/guard overlap reports.
 *
 * - Exact collision: `<base>-guard` AND `<base>-nudge` both present.
 * - Prefix pair: a `*-guard` and a `*-nudge` share their first `-` segment but
 *   are not an exact-base collision (advisory only).
 */
export function findOverlap(names: readonly string[]): OverlapReport {
  const guards = new Set<string>()
  const nudges = new Set<string>()
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.endsWith('-guard')) {
      guards.add(name.slice(0, -'-guard'.length))
    } else if (name.endsWith('-nudge')) {
      nudges.add(name.slice(0, -'-nudge'.length))
    }
  }
  const exactCollisions: string[] = []
  for (const base of guards) {
    if (nudges.has(base)) {
      exactCollisions.push(base)
    }
  }
  exactCollisions.sort()

  const collisionSet = new Set(exactCollisions)
  const prefixPairs: OverlapReport['prefixPairs'] = []
  for (const guardBase of guards) {
    const guardSegs = guardBase.split('-')
    for (const nudgeBase of nudges) {
      // Skip the exact-collision case (reported above).
      if (
        guardBase === nudgeBase ||
        collisionSet.has(guardBase) ||
        collisionSet.has(nudgeBase)
      ) {
        continue
      }
      // Require a 2+-segment shared leading prefix. A single shared segment
      // (`path-*`, `commit-*`, `claude-*`) is too coarse — those are distinct
      // concerns that merely share a namespace. Two segments
      // (`claude-md-*`, `parallel-agent-*`) is a strong enough signal that the
      // pair might be the same concern, worth a human glance.
      const nudgeSegs = nudgeBase.split('-')
      const shared = sharedPrefixSegments(guardSegs, nudgeSegs)
      if (shared >= 2) {
        prefixPairs.push({
          guard: `${guardBase}-guard`,
          nudge: `${nudgeBase}-nudge`,
          prefix: guardSegs.slice(0, shared).join('-'),
        })
      }
    }
  }
  prefixPairs.sort((a, b) => a.guard.localeCompare(b.guard))
  return { exactCollisions, prefixPairs }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hooksDir = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')
  const names = listHookNames(hooksDir)
  const { exactCollisions, prefixPairs } = findOverlap(names)

  if (exactCollisions.length) {
    logger.fail(
      '[check-hooks-have-no-guard-nudge-overlap] same-concern nudge + guard:',
    )
    for (let i = 0, { length } = exactCollisions; i < length; i += 1) {
      const base = exactCollisions[i]!
      logger.error(
        `  ✗ ${base}-guard AND ${base}-nudge both exist — collapse to one (prefer the guard; -guard blocks, -nudge nudges, one surface per concern).`,
      )
    }
    process.exitCode = 1
  }

  if (!quiet && prefixPairs.length) {
    logger.warn(
      '[check-hooks-have-no-guard-nudge-overlap] shared-prefix pairs (advisory — verify they are distinct concerns, not a latent duplicate):',
    )
    for (let i = 0, { length } = prefixPairs; i < length; i += 1) {
      const pair = prefixPairs[i]!
      logger.warn(`  • ${pair.guard} / ${pair.nudge} (prefix "${pair.prefix}")`)
    }
  }

  if (!quiet && !exactCollisions.length) {
    logger.success(
      `[check-hooks-have-no-guard-nudge-overlap] no same-concern nudge/guard duplicates across ${names.length} hooks.`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
