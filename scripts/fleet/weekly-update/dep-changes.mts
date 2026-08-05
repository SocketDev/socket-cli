/**
 * @file Turn two dependency snapshots into the delta the rolling PR shows
 *   inside each dated fold. Kept pure over text with no git or fs access,
 *   because the interesting cases are all data shape: a pin that moved, a
 *   package that appeared, a package that went away, and a file that failed to
 *   parse at all.
 *   Commit subjects are a poor substitute here. A dependency run squashes to a
 *   single "chore(deps): update dependencies", so a reader who opens the fold
 *   learns nothing about what actually moved. The table below is the thing
 *   worth reviewing.
 *   READ THE CATALOG, NOT JUST THE MANIFEST. The fleet pins exact versions and
 *   routes most of them through pnpm's catalog protocol, so the manifest says
 *   `catalog:` forever while the version it resolves to moves in
 *   `pnpm-workspace.yaml`. Diffing package.json alone would render an EMPTY
 *   table for exactly the dependencies an update touches. The catalog is
 *   therefore the primary source; manifest entries contribute only literal
 *   pins the catalog does not already carry.
 */

import { parseCatalogEntries } from '../lib/stable-alias.mts'

// The manifest fields that carry an installable dependency range. `peer` is
// included deliberately: a peer bump changes what a consumer must satisfy, so
// it belongs in a review summary even though it installs nothing here.
const DEP_FIELDS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

// A missing side. Rendered as an em dash, but kept as a sentinel so callers can
// distinguish "added" from "range happened to be empty".
export const ABSENT = undefined

export type DepChange = {
  name: string
  from: string | undefined
  to: string | undefined
}

/**
 * Every dependency range in `pkg`, flattened across the manifest's dependency
 * fields. A name present in two fields keeps the first range seen, which is the
 * DEP_FIELDS order above.
 */
export function collectDeps(pkg: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof pkg !== 'object' || pkg === null) {
    return out
  }
  const record = pkg as Record<string, unknown>
  for (let i = 0, { length } = DEP_FIELDS; i < length; i += 1) {
    const bag = record[DEP_FIELDS[i] as string]
    if (typeof bag !== 'object' || bag === null) {
      continue
    }
    for (const [name, range] of Object.entries(
      bag as Record<string, unknown>,
    )) {
      if (typeof range === 'string' && !out.has(name)) {
        out.set(name, range)
      }
    }
  }
  return out
}

/**
 * Parse a manifest, returning an empty map rather than throwing. A run whose
 * manifest is unreadable should still produce a PR body.
 */
export function collectDepsFromJson(text: string): Map<string, string> {
  try {
    return collectDeps(JSON.parse(text))
  } catch {
    return new Map<string, string>()
  }
}

// A pnpm catalog protocol reference: `catalog:` or `catalog:<name>`. The value
// is a POINTER, never a version, so it must be resolved before it can be
// compared. An unresolvable one is dropped rather than rendered, since
// `catalog:` on both sides would compare equal and say nothing anyway.
const CATALOG_REF_RE = /^catalog:/

// Specifiers that name a location rather than a version. They do not move in a
// way worth reporting, so they stay out of the table.
const NON_VERSION_RE =
  /^(?:file:|git\+|https?:|link:|npm:.*@workspace|workspace:)/

/**
 * `pnpm.overrides` from a manifest. Overrides are the one place the fleet
 * allows a range rather than an exact pin, so they are collected separately and
 * labelled in the table instead of being mixed in with the pins.
 */
export function collectOverrides(pkg: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof pkg !== 'object' || pkg === null) {
    return out
  }
  const pnpm = (pkg as Record<string, unknown>)['pnpm']
  if (typeof pnpm !== 'object' || pnpm === null) {
    return out
  }
  const overrides = (pnpm as Record<string, unknown>)['overrides']
  if (typeof overrides !== 'object' || overrides === null) {
    return out
  }
  for (const [name, value] of Object.entries(
    overrides as Record<string, unknown>,
  )) {
    if (typeof value === 'string') {
      out.set(`${name} (override)`, value)
    }
  }
  return out
}

/**
 * Every pinned version one side of the update declares, merged from the catalog
 * and the manifest.
 *
 * The catalog wins on conflict: it is the shared pin the fleet actually moves,
 * and a manifest entry for the same name is either a `catalog:` pointer at it
 * or a local override of it. Manifest entries contribute only names the catalog
 * does not carry. Neither file being readable yields an empty map rather than
 * throwing, because this feeds a PR body the workflow pipes straight into `gh`.
 */
export function collectPins(config: {
  manifestText: string
  workspaceText: string
}): Map<string, string> {
  const { manifestText, workspaceText } = config
  const out = new Map<string, string>()

  // Primary source: the catalog's exact pins.
  let catalog = new Map<string, string>()
  try {
    catalog = parseCatalogEntries(workspaceText)
  } catch {
    catalog = new Map<string, string>()
  }
  for (const [name, version] of catalog) {
    if (!NON_VERSION_RE.test(version)) {
      out.set(name, version)
    }
  }

  // Secondary: literal pins the manifest declares directly. A `catalog:`
  // pointer resolves against the map above; anything still unresolved is
  // dropped rather than compared as a pointer string.
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    parsed = undefined
  }
  for (const [name, spec] of collectDeps(parsed)) {
    if (CATALOG_REF_RE.test(spec)) {
      continue
    }
    if (NON_VERSION_RE.test(spec)) {
      continue
    }
    if (!out.has(name)) {
      out.set(name, spec)
    }
  }

  for (const [name, spec] of collectOverrides(parsed)) {
    out.set(name, spec)
  }
  return out
}

/**
 * What changed between two manifests, sorted by name so the rendered table is
 * stable across runs and diffs cleanly when the body is refreshed.
 */
export function diffDeps(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): DepChange[] {
  const names = [...new Set<string>([...before.keys(), ...after.keys()])]
  const sorted = names.toSorted()
  const out: DepChange[] = []
  for (let i = 0, { length } = sorted; i < length; i += 1) {
    const name = sorted[i] as string
    const from = before.get(name)
    const to = after.get(name)
    if (from !== to) {
      out.push({ name, from, to })
    }
  }
  return out
}

/**
 * The dependency delta as a markdown table. Returns an empty string for an
 * empty delta so callers can decide what to say instead.
 */
export function renderDepChanges(changes: readonly DepChange[]): string {
  if (!changes.length) {
    return ''
  }
  const rows = changes.map(change => {
    const from = change.from ?? '—'
    const to = change.to ?? '—'
    return `| \`${change.name}\` | ${from} | ${to} |`
  })
  return ['| package | from | to |', '| --- | --- | --- |', ...rows].join('\n')
}

/**
 * A one-line count for the fold's summary, so the delta's size is readable
 * without expanding it.
 */
export function summarizeDepChanges(changes: readonly DepChange[]): string {
  if (!changes.length) {
    return 'no dependency changes'
  }
  let added = 0
  let removed = 0
  let updated = 0
  for (const change of changes) {
    if (change.from === ABSENT) {
      added += 1
    } else if (change.to === ABSENT) {
      removed += 1
    } else {
      updated += 1
    }
  }
  const parts: string[] = []
  if (updated) {
    parts.push(`${updated} updated`)
  }
  if (added) {
    parts.push(`${added} added`)
  }
  if (removed) {
    parts.push(`${removed} removed`)
  }
  return parts.join(', ')
}
