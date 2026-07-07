#!/usr/bin/env node
/*
 * @file Commit-time dedup gate — the code-as-law surface the
 *   `deduping-dependencies` skill cites. Parses `pnpm-lock.yaml` and reports
 *   two avoidable shapes the dedup decision tree is meant to eliminate:
 *
 *   1. CROSS-MAJOR DUPLICATES — a package resolved at more than one distinct
 *      major version in the install tree. Each extra major is dead weight
 *      (more bytes, more attack surface, bigger bundles). The skill's decision
 *      tree classifies whether a given family is collapsible; this gate just
 *      surfaces the family so it can't silently re-accumulate.
 *   2. UN-REDIRECTED DROP-INS — a package that has a known
 *      `@socketregistry/<name>` hardened drop-in (learned from the lockfile's
 *      own `overrides:` block — the fleet's curated redirect set) but is itself
 *      resolved WITHOUT that redirect. A `@socketregistry/*` drop-in is
 *      Socket-published + audited + API-transparent and soak-exempt, so an
 *      un-redirected copy is a free hardening + dedup win left on the table.
 *
 *   The judgment (which collapse is safe — format-flip vs API break, the
 *   consumer-grep) stays in the skill; this is the mechanical scan only.
 *
 *   Cross-major reporting is gated by a repo-owned record,
 *   `.config/repo/reviewed-duplicates.json`, which lists families classified via
 *   the dedup decision tree and consciously left duplicated (each with a
 *   reason). The record's PRESENCE opts the repo into enforcement: a cross-major
 *   family not covered there — or one that gained a new major — then fails, so
 *   the dedup posture can't silently drift (collapse it via overrides:, or add
 *   it to the record). Without the record the cross-major report stays
 *   informational (exit 0; collapsing is a judgment call). A missing
 *   `@socketregistry` redirect is always a hard failure (the redirect is safe to
 *   add). No-ops when `pnpm-lock.yaml` is absent. Exit codes:
 *
 *   - 0 — no missing `@socketregistry` redirect, and (opted-in repo) every
 *     cross-major family is reviewed; reviewed + stale entries are logged.
 *   - 1 — a missing `@socketregistry` redirect, or an unreviewed cross-major
 *     family in an opted-in repo.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { PNPM_LOCK } from '../paths.mts'

// A `packages:` (or `snapshots:`) key: `'<name>@<version>':` where name may be
// scoped (`@scope/pkg`). Indented exactly two spaces under the section header.
const PACKAGE_KEY_RE =
  /^ {2}'?((?:@[^@/'\s]+\/)?[^@'\s]+)@([^'\s(]+)(?:\([^)]*\))*'?:\s*$/
// An `overrides:` redirect value pointing at a Socket hardened drop-in:
// `name: npm:@socketregistry/<dropin>@<version>` (quoted or bare).
const DROP_IN_OVERRIDE_RE =
  /^ {2}'?([^':\s]+)'?:\s*'?npm:@socketregistry\/([^@'\s]+)@/
// A plain (non-drop-in) override entry: `name: <value>` — used to learn which
// package names already carry SOME override (so we don't double-flag a name
// that's pinned a different way).
const ANY_OVERRIDE_RE = /^ {2}'?((?:@[^@/'\s]+\/)?[^@'\s]+)(?:@[^':]*)?'?:\s*\S/

export interface DuplicateFamily {
  name: string
  majors: string[]
}

export interface UnredirectedDropIn {
  name: string
  dropIn: string
}

export interface ScanResult {
  duplicates: DuplicateFamily[]
  unredirected: UnredirectedDropIn[]
}

export interface ReviewedDuplicate {
  majors: string[]
  reason: string
}

// The repo-owned record of cross-major families classified via the dedup
// decision tree and consciously left duplicated. Its PRESENCE opts a repo into
// the gate: a cross-major family not covered here then fails (must be collapsed
// or recorded). Absent → the cross-major report stays informational (the
// historical behavior; collapsing is a judgment call).
const REVIEWED_DUPLICATES_PATH = path.join(
  '.config',
  'repo',
  'reviewed-duplicates.json',
)

export function readReviewedDuplicates(
  repoRoot: string,
): Map<string, ReviewedDuplicate> | undefined {
  let raw: string
  try {
    raw = readFileSync(path.join(repoRoot, REVIEWED_DUPLICATES_PATH), 'utf8')
  } catch {
    return undefined
  }
  const parsed = JSON.parse(raw) as {
    reviewed?: Record<string, ReviewedDuplicate> | undefined
  }
  const out = new Map<string, ReviewedDuplicate>()
  const entries = parsed.reviewed ?? {}
  for (const name of Object.keys(entries)) {
    out.set(name, entries[name]!)
  }
  return out
}

export interface DuplicatePartition {
  // Families whose every current major is covered by a reviewed entry.
  reviewed: DuplicateFamily[]
  // Families with no reviewed entry, OR one missing a current major (a new
  // major appeared → re-review). The actionable signal.
  unreviewed: DuplicateFamily[]
  // Reviewed entries that are no longer a cross-major duplicate (collapsed /
  // dropped) — stale records to delete.
  stale: string[]
}

// Split duplicate families by whether the reviewed record covers them. A family
// is reviewed only when EVERY current major is listed (a new major forces a
// re-review). A `undefined` record (repo hasn't opted in) → everything is
// unreviewed, but the caller keeps the report informational.
export function partitionDuplicates(
  duplicates: DuplicateFamily[],
  reviewed: Map<string, ReviewedDuplicate> | undefined,
): DuplicatePartition {
  const map = reviewed ?? new Map<string, ReviewedDuplicate>()
  const reviewedFamilies: DuplicateFamily[] = []
  const unreviewed: DuplicateFamily[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = duplicates; i < length; i += 1) {
    const f = duplicates[i]!
    const entry = map.get(f.name)
    if (entry) {
      seen.add(f.name)
      const allowed = new Set(entry.majors)
      if (f.majors.every(m => allowed.has(m))) {
        reviewedFamilies.push(f)
        continue
      }
    }
    unreviewed.push(f)
  }
  const stale: string[] = []
  for (const name of map.keys()) {
    if (!seen.has(name)) {
      stale.push(name)
    }
  }
  return { reviewed: reviewedFamilies, stale: stale.toSorted(), unreviewed }
}

// Reduce a semver-ish version string to its major component. A `0.x` package
// treats the MINOR as the breaking axis (semver's pre-1.0 rule), so
// `0.30.21` → `0.30` while `7.8.1` → `7`. Keeps a bare/odd version intact.
export function majorOf(version: string): string {
  const parts = version.split('.')
  const first = parts[0] ?? version
  if (first === '0' && parts.length > 1) {
    return `0.${parts[1]}`
  }
  return first
}

// Collect every `<name>@<version>` key under a top-level section (`packages:`
// or `snapshots:`), returning name → set of distinct versions.
function collectResolvedVersions(lines: string[]): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>()
  let inSection = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'packages:' || line === 'snapshots:') {
      inSection = true
      continue
    }
    // A new unindented top-level key ends the section.
    if (inSection && /^[A-Za-z_]/.test(line)) {
      inSection = false
      continue
    }
    if (!inSection) {
      continue
    }
    const m = PACKAGE_KEY_RE.exec(line)
    if (!m) {
      continue
    }
    const name = m[1]!
    const version = m[2]!
    let versions = byName.get(name)
    if (!versions) {
      versions = new Set<string>()
      byName.set(name, versions)
    }
    versions.add(version)
  }
  return byName
}

// Learn the fleet's curated drop-in set + which names already carry an override
// from the lockfile's own `overrides:` block (pnpm mirrors pnpm-workspace.yaml
// here). Returns the redirect map (name → drop-in) and the set of names that
// already have ANY override entry.
function collectOverrides(lines: string[]): {
  dropIns: Map<string, string>
  overridden: Set<string>
} {
  const dropIns = new Map<string, string>()
  const overridden = new Set<string>()
  let inOverrides = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'overrides:') {
      inOverrides = true
      continue
    }
    if (inOverrides && /^[A-Za-z_]/.test(line)) {
      inOverrides = false
      continue
    }
    if (!inOverrides) {
      continue
    }
    const dropIn = DROP_IN_OVERRIDE_RE.exec(line)
    if (dropIn) {
      dropIns.set(dropIn[1]!, dropIn[2]!)
    }
    const any = ANY_OVERRIDE_RE.exec(line)
    if (any) {
      overridden.add(any[1]!)
    }
  }
  return { dropIns, overridden }
}

export function scan(text: string): ScanResult {
  const lines = text.split('\n')
  const byName = collectResolvedVersions(lines)
  const { dropIns, overridden } = collectOverrides(lines)

  const duplicates: DuplicateFamily[] = []
  for (const [name, versions] of byName) {
    const majors = [...new Set([...versions].map(majorOf))].toSorted((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )
    if (majors.length > 1) {
      duplicates.push({ majors, name })
    }
  }
  duplicates.sort((a, b) => a.name.localeCompare(b.name))

  // The drop-in set learned from `overrides:` is the fleet's curated redirect
  // list. A package is un-redirected when it resolves in the tree, a drop-in
  // exists for its bare name, yet its name carries no override at all (so the
  // hardened copy was never wired in). A name already in `overridden` is
  // covered — even a scoped or version-pinned override counts.
  const unredirected: UnredirectedDropIn[] = []
  for (const [name, dropIn] of dropIns) {
    if (!byName.has(name)) {
      continue
    }
    if (overridden.has(name)) {
      continue
    }
    unredirected.push({ dropIn, name })
  }
  unredirected.sort((a, b) => a.name.localeCompare(b.name))

  return { duplicates, unredirected }
}

function main(): void {
  let content: string
  try {
    content = readFileSync(PNPM_LOCK, 'utf8')
  } catch {
    // No pnpm-lock.yaml — not an installed workspace, nothing to check.
    process.exit(0)
  }
  const { duplicates, unredirected } = scan(content)
  const reviewed = readReviewedDuplicates(path.dirname(PNPM_LOCK))
  const {
    reviewed: reviewedFamilies,
    stale,
    unreviewed,
  } = partitionDuplicates(duplicates, reviewed)
  // The record's presence opts the repo into the gate: an UNREVIEWED cross-major
  // family is then a hard failure. Without it the report stays informational.
  const enforce = reviewed !== undefined
  let failed = false

  if (reviewedFamilies.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] ${reviewedFamilies.length} cross-major ` +
        `${reviewedFamilies.length === 1 ? 'family' : 'families'} reviewed + ` +
        `left duplicated (${REVIEWED_DUPLICATES_PATH}).\n`,
    )
  }
  if (stale.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] ${stale.length} stale reviewed ` +
        `entr${stale.length === 1 ? 'y' : 'ies'} — no longer a cross-major ` +
        `duplicate; drop from ${REVIEWED_DUPLICATES_PATH}: ${stale.join(', ')}\n`,
    )
  }

  if (unreviewed.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] ${unreviewed.length} package` +
        `${unreviewed.length === 1 ? '' : 's'} resolved at >1 major ` +
        `(${enforce ? 'UNREVIEWED — classify' : 'collapse candidates'} with the ` +
        `dedup decision tree):\n`,
    )
    for (let i = 0, { length } = unreviewed; i < length; i += 1) {
      const f = unreviewed[i]!
      process.stderr.write(`  ${f.name}: majors ${f.majors.join(', ')}\n`)
    }
    process.stderr.write(
      `\nNot every duplicate is collapsible (format-flip vs API break). Collapse\n` +
        `via overrides:, or record the family + a reason in\n` +
        `${REVIEWED_DUPLICATES_PATH}. See\n` +
        `.claude/skills/fleet/deduping-dependencies/SKILL.md.\n\n`,
    )
    if (enforce) {
      failed = true
    }
  }

  if (unredirected.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] ${unredirected.length} package` +
        `${unredirected.length === 1 ? '' : 's'} with a @socketregistry ` +
        `drop-in but no redirect:\n`,
    )
    for (let i = 0, { length } = unredirected; i < length; i += 1) {
      const f = unredirected[i]!
      process.stderr.write(`  ${f.name} → @socketregistry/${f.dropIn}\n`)
    }
    process.stderr.write(
      `\nAdd the redirect to overrides: in pnpm-workspace.yaml (fleet-canonical\n` +
        `via FLEET_CANONICAL_OVERRIDES). A @socketregistry drop-in is audited +\n` +
        `soak-exempt — the redirect is always safe. See\n` +
        `.claude/skills/fleet/deduping-dependencies/SKILL.md.\n`,
    )
    failed = true
  }

  process.exit(failed ? 1 : 0)
}

// Run only when invoked directly (CLI / CI), not when imported by the unit
// tests for `scan` — `main()` calls `process.exit`, which would tear down the
// test runner mid-suite.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
