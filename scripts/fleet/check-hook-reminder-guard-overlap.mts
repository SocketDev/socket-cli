// Fleet check — reminder/guard duplication.
//
// Fleet convention (CLAUDE.md hook naming): a `-guard` hook BLOCKS, a
// `-reminder` hook NUDGES. One surface per concern — never both a `-guard`
// and a `-reminder` for the same thing. Duplication crept in once (the prose
// antipattern reminder + guard overlap, 2026-06-03) and was resolved by
// dropping the reminder in favor of the hard guard. This check stops it from
// recurring.
//
// ERROR: a base name has BOTH `<base>-guard` and `<base>-reminder`. That is an
// exact same-concern duplicate — collapse to one (prefer the guard).
//
// ADVISORY: two hooks share a leading name segment but differ after it (e.g.
// `prose-antipattern-guard` + `prose-tone-reminder`). These MAY be distinct
// facets (they were, once disambiguated) or a latent duplicate — the check
// cannot tell semantic overlap from a shared prefix, so it lists them for a
// human glance without failing.
//
// Usage: node scripts/fleet/check-hook-reminder-guard-overlap.mts [--quiet]

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// scripts/fleet/ → repo root → .claude/hooks/fleet/. In the wheelhouse the
// canonical hooks live under template/; downstream they sit at the repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..')

export interface OverlapReport {
  exactCollisions: string[]
  prefixPairs: Array<{ guard: string; reminder: string; prefix: string }>
}

/**
 * List the immediate `<name>` hook directories under a fleet hooks dir.
 * Returns an empty array when the dir is absent (a repo with no hooks).
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
 * Classify hook names into reminder/guard overlap reports.
 *
 * - Exact collision: `<base>-guard` AND `<base>-reminder` both present.
 * - Prefix pair: a `*-guard` and a `*-reminder` share their first `-`
 *   segment but are not an exact-base collision (advisory only).
 */
export function findOverlap(names: readonly string[]): OverlapReport {
  const guards = new Set<string>()
  const reminders = new Set<string>()
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.endsWith('-guard')) {
      guards.add(name.slice(0, -'-guard'.length))
    } else if (name.endsWith('-reminder')) {
      reminders.add(name.slice(0, -'-reminder'.length))
    }
  }
  const exactCollisions: string[] = []
  for (const base of guards) {
    if (reminders.has(base)) {
      exactCollisions.push(base)
    }
  }
  exactCollisions.sort()

  const collisionSet = new Set(exactCollisions)
  const prefixPairs: OverlapReport['prefixPairs'] = []
  for (const guardBase of guards) {
    const guardSegs = guardBase.split('-')
    for (const reminderBase of reminders) {
      // Skip the exact-collision case (reported above).
      if (
        guardBase === reminderBase ||
        collisionSet.has(guardBase) ||
        collisionSet.has(reminderBase)
      ) {
        continue
      }
      // Require a 2+-segment shared leading prefix. A single shared segment
      // (`path-*`, `commit-*`, `claude-*`) is too coarse — those are distinct
      // concerns that merely share a namespace. Two segments
      // (`claude-md-*`, `parallel-agent-*`) is a strong enough signal that the
      // pair might be the same concern, worth a human glance.
      const reminderSegs = reminderBase.split('-')
      const shared = sharedPrefixSegments(guardSegs, reminderSegs)
      if (shared >= 2) {
        prefixPairs.push({
          guard: `${guardBase}-guard`,
          prefix: guardSegs.slice(0, shared).join('-'),
          reminder: `${reminderBase}-reminder`,
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
      '[check-hook-reminder-guard-overlap] same-concern reminder + guard:',
    )
    for (let i = 0, { length } = exactCollisions; i < length; i += 1) {
      const base = exactCollisions[i]!
      logger.error(
        `  ✗ ${base}-guard AND ${base}-reminder both exist — collapse to one (prefer the guard; -guard blocks, -reminder nudges, one surface per concern).`,
      )
    }
    process.exitCode = 1
  }

  if (!quiet && prefixPairs.length) {
    logger.warn(
      '[check-hook-reminder-guard-overlap] shared-prefix pairs (advisory — verify they are distinct concerns, not a latent duplicate):',
    )
    for (let i = 0, { length } = prefixPairs.length; i < length; i += 1) {
      const pair = prefixPairs[i]!
      logger.warn(`  • ${pair.guard} / ${pair.reminder} (prefix "${pair.prefix}")`)
    }
  }

  if (!quiet && !exactCollisions.length) {
    logger.success(
      `[check-hook-reminder-guard-overlap] no same-concern reminder/guard duplicates across ${names.length} hooks.`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
