/**
 * @file Shared coverage-badge logic for make-coverage-badge.mts (writes the
 *   README badge from a coverage run) and check/coverage-badge-is-current.mts
 *   (asserts the badge matches actual coverage). One place owns the badge URL
 *   shape, the color buckets, the README regex, and the coverage-total read, so
 *   the writer and the checker can never disagree on what "current" means.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// The canonical README coverage badge (template/README.md):
//   ![Coverage](https://img.shields.io/badge/coverage-<PCT>%25-<color>)
// A freshly-seeded repo carries the literal `<PCT>` placeholder until the first
// `make-coverage-badge` run fills it. The percent segment is `<PCT>` OR an
// integer (the populated form); the color segment is any shields color word.
// Groups: (1) the `![Coverage](…/coverage-` prefix; (2) the percent — `<PCT>`
// or digits; (3) the `%25-` separator; (4) the color word; (5) the closing `)`.
// writeBadge rewrites groups 2 + 4.
const BADGE_RE =
  /(!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/coverage-)(<PCT>|\d+)(%25-)([a-z]+)(\))/ // socket-lint: allow uncommented-regex

// The literal placeholder a seeded-but-never-measured repo carries. The check
// treats a badge still at the placeholder as "not yet measured" (fail-open),
// never a mismatch — the repo simply hasn't run coverage.
export const BADGE_PLACEHOLDER = '<PCT>'

export interface BadgeMatch {
  // The current percent segment: the `<PCT>` placeholder or an integer string.
  readonly pct: string
  // The current shields color word.
  readonly color: string
}

// shields.io color bucket for a coverage percent. Mirrors the conventional
// coverage gradient so the badge reads at a glance.
export function badgeColor(pct: number): string {
  if (pct >= 90) {
    return 'brightgreen'
  }
  if (pct >= 80) {
    return 'green'
  }
  if (pct >= 70) {
    return 'yellowgreen'
  }
  if (pct >= 60) {
    return 'yellow'
  }
  if (pct >= 50) {
    return 'orange'
  }
  return 'red'
}

// The README badge's current { pct, color }, or undefined when no coverage
// badge is present (a repo that opted out of the badge — not an error).
export function parseBadge(readme: string): BadgeMatch | undefined {
  const m = BADGE_RE.exec(readme)
  return m ? { pct: m[2]!, color: m[4]! } : undefined
}

// Rewrite the README's coverage badge to `pct` (rounded integer) + its bucket
// color. Returns the new README text, unchanged when no badge is present.
export function writeBadge(readme: string, pct: number): string {
  const rounded = String(Math.round(pct))
  const color = badgeColor(pct)
  return readme.replace(BADGE_RE, `$1${rounded}$3${color}$5`)
}

// The line-coverage total percent from a vitest `coverage/coverage-summary.json`
// (the `json-summary` reporter). Returns undefined when the file is absent or
// shapeless — the caller decides whether that's fail-open (the check) or an
// error (the writer, which needs a real number).
export function readCoveragePct(repoRoot: string): number | undefined {
  const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json')
  if (!existsSync(summaryPath)) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(summaryPath, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const total = (parsed as Record<string, unknown>)['total']
  if (typeof total !== 'object' || total === null) {
    return undefined
  }
  const lines = (total as Record<string, unknown>)['lines']
  if (typeof lines !== 'object' || lines === null) {
    return undefined
  }
  const pct = (lines as Record<string, unknown>)['pct']
  return typeof pct === 'number' ? pct : undefined
}
