/**
 * @file Gap engine — lockfile ↔ catalog drift.
 *   Pure functions, no FS reads, no spawn. A pnpm-workspace.yaml `catalog:`
 *   (or `catalogs: > <named>:`) entry can be bumped without re-running
 *   `pnpm install`, leaving the resolved specifier in pnpm-lock.yaml's
 *   top-level `catalogs:` block stale. CI's `pnpm install --frozen-lockfile`
 *   then fails. This engine parses both sides and reports (report-only — the
 *   fix, `pnpm install`, is pnpm-owned) every catalog entry the lockfile
 *   RESOLVED (a package references it via `catalog:`) whose resolved specifier
 *   differs from the bumped workspace value. Entries the lockfile doesn't
 *   record are defined-but-unreferenced, not drift.
 */

import { parseCatalogBlock, parseNamedCatalogs } from '../workspace-yaml.mts'

import type { DoctorFinding } from './catalog-gap.mts'

/**
 * Strip one layer of surrounding single/double quotes from a YAML scalar.
 */
export function unquoteScalar(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    (trimmed[0] === "'" || trimmed[0] === '"') &&
    trimmed[trimmed.length - 1] === trimmed[0]
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Parse pnpm-lock.yaml's top-level `catalogs:` block into
 * `{ <catalogName>: { <dep>: <specifier> } }` (the default catalog is keyed
 * `'default'`). Reads the `specifier:` of each entry — the value the workspace
 * catalog is compared against. Indentation-based (pnpm writes 2-space); returns
 * an empty object when there is no `catalogs:` block.
 */
export function parseLockfileCatalogs(
  lockfileYaml: string,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = Object.create(null)
  const lines = lockfileYaml.split('\n')
  let i = 0
  for (; i < lines.length; i += 1) {
    if (/^catalogs:\s*$/.test(lines[i]!)) {
      i += 1
      break
    }
  }
  let currentCatalog: string | undefined
  let currentDep: string | undefined
  for (; i < lines.length; i += 1) {
    const raw = lines[i]!
    if (raw.trim() === '') {
      continue
    }
    const indent = raw.length - raw.trimStart().length
    // A non-blank line back at column 0 is the next top-level key — the
    // catalogs block is done.
    if (indent === 0) {
      break
    }
    const line = raw.trim()
    if (indent === 2 && line.endsWith(':')) {
      currentCatalog = unquoteScalar(line.slice(0, -1))
      result[currentCatalog] = Object.create(null) as Record<string, string>
      currentDep = undefined
      continue
    }
    if (indent === 4 && line.endsWith(':') && currentCatalog) {
      currentDep = unquoteScalar(line.slice(0, -1))
      continue
    }
    if (indent >= 6 && currentCatalog && currentDep) {
      const match = /^specifier:\s*(.+)$/.exec(line)
      if (match) {
        result[currentCatalog]![currentDep] = unquoteScalar(match[1]!)
      }
    }
  }
  return result
}

function driftFinding(config: {
  catalogName: string
  dep: string
  lockValue: string
  workspaceValue: string
}): DoctorFinding {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const where =
    cfg.catalogName === 'default'
      ? `pnpm-workspace.yaml catalog: '${cfg.dep}'`
      : `pnpm-workspace.yaml catalogs.${cfg.catalogName}.'${cfg.dep}'`
  const saw = `catalog pins '${cfg.dep}': ${cfg.workspaceValue} but pnpm-lock.yaml resolved it as ${cfg.lockValue}`
  return {
    fix: [
      "Run `pnpm install` to reconcile pnpm-lock.yaml's catalogs block with",
      'the workspace catalog, then commit the updated pnpm-lock.yaml. CI runs',
      '`--frozen-lockfile`, so a stale catalog resolution fails the install.',
    ].join('\n'),
    fixable: false,
    saw,
    wanted: `pnpm-lock.yaml catalogs.${cfg.catalogName}.'${cfg.dep}' specifier == ${cfg.workspaceValue}`,
    what: `Lockfile catalog drift: '${cfg.dep}' (catalog '${cfg.catalogName}') is out of sync with pnpm-lock.yaml`,
    where,
  }
}

/**
 * Compare every pnpm-workspace.yaml catalog entry (default + named) against the
 * lockfile's resolved catalog specifiers. Report-only: an entry the lockfile
 * resolved but whose specifier differs from the workspace value is a pending
 * `pnpm install`. Entries absent from the lockfile catalogs are skipped
 * (defined-but-unreferenced, not drift).
 */
export function diagnoseLockfileCatalogDrift(config: {
  lockfileYaml: string
  workspaceYaml: string
}): DoctorFinding[] {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const lockCatalogs = parseLockfileCatalogs(cfg.lockfileYaml)
  const findings: DoctorFinding[] = []

  const compare = (
    catalogName: string,
    workspaceEntries: Record<string, string>,
  ): void => {
    const lockEntries = lockCatalogs[catalogName] ?? {}
    const deps = Object.keys(workspaceEntries).toSorted()
    for (let i = 0, { length } = deps; i < length; i += 1) {
      const dep = deps[i]!
      const workspaceValue = workspaceEntries[dep]!
      // A `catalog:`-forwarded entry (rare in the catalog block itself) has no
      // concrete version to compare — skip it.
      if (workspaceValue.startsWith('catalog:')) {
        continue
      }
      // Only flag a STALE resolution: the entry IS in the lockfile catalogs
      // (so a package references it via `catalog:`) but its resolved specifier
      // differs from the bumped workspace value. An entry ABSENT from the
      // lockfile is a defined-but-unreferenced catalog entry (pnpm records only
      // used ones) — not drift, and flagging it floods false positives.
      const lockValue = lockEntries[dep]
      if (lockValue !== undefined && lockValue !== workspaceValue) {
        findings.push(
          driftFinding({ catalogName, dep, lockValue, workspaceValue }),
        )
      }
    }
  }

  compare('default', parseCatalogBlock(cfg.workspaceYaml))
  const named = parseNamedCatalogs(cfg.workspaceYaml)
  const namedKeys = Object.keys(named).toSorted()
  for (let i = 0, { length } = namedKeys; i < length; i += 1) {
    const name = namedKeys[i]!
    compare(name, named[name]!)
  }
  return findings
}
