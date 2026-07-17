#!/usr/bin/env node
/**
 * @file Enforce baseline `catalog:` deps ⊆ EXPECTED_CATALOG_ENTRIES ∪
 *   OPTIONAL_CATALOG_ENTRIES. The fleet package.json BASELINE
 *   (checks/package-baseline-is-current.mts → CANONICAL_CATALOG_DEPS, derived
 *   from every devDependency the wheelhouse pins to `catalog:`) is what the
 *   cascade WRITES onto every member's package.json as `"<name>": "catalog:"`.
 *   For that reference to resolve, the cascade must ALSO inject a matching
 *   `catalog:` entry into the member's pnpm-workspace.yaml — and it only
 *   injects the names in EXPECTED_CATALOG_ENTRIES (always) /
 *   OPTIONAL_CATALOG_ENTRIES (when already present). A baseline dep absent from
 *   BOTH maps gets the package.json `catalog:` ref with NO catalog entry, so
 *   the member's next `pnpm install` dies with
 *   ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC and can never reconcile. Past
 *   incident: the baseline wrote `@types/semver: catalog:` (plus.
 *
 * @types/node, magic-string, markdownlint, markdownlint-cli2, semver, nock)
 *   onto members while none of those were in EXPECTED/OPTIONAL_CATALOG_ENTRIES
 *   — every member cascade (hit on socket-mcp + socket-registry) installed red.
 *   nock was the subtler shape: it WAS in FLEET_CANONICAL_CATALOG_NAMES but
 *   missing from the version-source template/base/.config/fleet/pnpm-workspace.fleet.yaml, so
 *   loadExpectedCatalogEntries() silently skipped it and EXPECTED never carried
 *   it. This gate catches BOTH (a name not in the map, and a name in the map
 *   the version-source drops) because it asserts membership of the RESOLVED
 *   entries, not the raw NAME maps.
 *
 *   The invariant: **EXPECTED_CATALOG_ENTRIES ∪ OPTIONAL_CATALOG_ENTRIES must be
 *   a SUPERSET of the baseline `catalog:` refs** so every `catalog:` the cascade
 *   writes onto a member resolves to a catalog entry the cascade also writes.
 *
 *   Exit 0 = covered. Exit 1 = a baseline dep is uncovered; lists the gaps. CI
 *   gate via scripts/fleet/check.mts. Wheelhouse-only — fleet repos don't ship
 *   the sync-scaffolding manifest; the check no-ops there (the cascade hands
 *   members the resolved catalog, not these maps).
 *
 *   Usage: node scripts/fleet/check/baseline-catalog-deps-are-covered.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The wheelhouse-only orchestration modules. Fleet repos don't ship
// `scripts/repo/sync-scaffolding/`, so this check is meaningful only when
// invoked from the wheelhouse itself (the existsSync gate below makes it a
// no-op everywhere else, keeping the canonical check.mts step inert fleet-wide).
const CATALOG_MANIFEST = path.join(
  REPO_ROOT,
  'scripts/repo/sync-scaffolding/manifest/catalog.mts',
)
const BASELINE_CHECK = path.join(
  REPO_ROOT,
  'scripts/repo/sync-scaffolding/checks/package-baseline-is-current.mts',
)

/**
 * Compute the coverage gap: baseline `catalog:` deps that are NOT keys of the
 * resolved EXPECTED ∪ OPTIONAL catalog-entry maps. Pure + sorted for stable
 * output + offline-testable.
 */
export function uncoveredBaselineDeps(
  baselineDeps: readonly string[],
  expectedNames: readonly string[],
  optionalNames: readonly string[],
): string[] {
  const covered = new Set<string>([...expectedNames, ...optionalNames])
  const gaps: string[] = []
  for (let i = 0, { length } = baselineDeps; i < length; i += 1) {
    const dep = baselineDeps[i]!
    if (!covered.has(dep)) {
      gaps.push(dep)
    }
  }
  return gaps.toSorted()
}

async function main(): Promise<void> {
  // Wheelhouse-only. Both modules live under scripts/repo/sync-scaffolding/,
  // which fleet repos don't carry — no-op there so the shared check.mts step is
  // inert across the cascaded fleet.
  if (!existsSync(CATALOG_MANIFEST) || !existsSync(BASELINE_CHECK)) {
    return
  }
  const quiet = process.argv.includes('--quiet')

  // Dynamic import keeps fleet repos (no manifest) from failing at
  // module-resolution time — the existsSync gate above proves they're loadable.
  const { EXPECTED_CATALOG_ENTRIES, OPTIONAL_CATALOG_ENTRIES } = (await import(
    CATALOG_MANIFEST
  )) as {
    EXPECTED_CATALOG_ENTRIES: Readonly<Record<string, unknown>>
    OPTIONAL_CATALOG_ENTRIES: Readonly<Record<string, unknown>>
  }
  const { CANONICAL_CATALOG_DEPS } = (await import(BASELINE_CHECK)) as {
    CANONICAL_CATALOG_DEPS: readonly string[]
  }

  const gaps = uncoveredBaselineDeps(
    CANONICAL_CATALOG_DEPS,
    Object.keys(EXPECTED_CATALOG_ENTRIES),
    Object.keys(OPTIONAL_CATALOG_ENTRIES),
  )

  if (gaps.length === 0) {
    if (!quiet) {
      logger.log(
        `[baseline-catalog-deps-are-covered] all clean — ${CANONICAL_CATALOG_DEPS.length} baseline \`catalog:\` deps all covered.`,
      )
    }
    return
  }

  logger.fail(
    [
      '[baseline-catalog-deps-are-covered] Uncovered baseline `catalog:` dep(s).',
      '',
      '  What: the fleet package.json baseline (CANONICAL_CATALOG_DEPS, derived',
      '  from the wheelhouse’s own `catalog:` devDependencies) writes these as',
      '  `"<name>": "catalog:"` onto every member’s package.json, but they are',
      '  NOT in EXPECTED_CATALOG_ENTRIES or OPTIONAL_CATALOG_ENTRIES — so the',
      '  cascade injects NO matching catalog entry into the member’s',
      '  pnpm-workspace.yaml.',
      '',
      '  Where: scripts/repo/sync-scaffolding/manifest/catalog.mts',
      '  (FLEET_CANONICAL_CATALOG_NAMES / OPTIONAL_CATALOG_NAMES + their',
      '  version-source template/base/.config/fleet/pnpm-workspace.fleet.yaml).',
      '',
      '  Saw vs. wanted: each member install resolves `"<name>": "catalog:"` and',
      '  dies with ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC. Wanted: EXPECTED ∪',
      '  OPTIONAL catalog entries is a SUPERSET of the baseline `catalog:` refs.',
      '',
      '  Uncovered:',
      ...gaps.map(g => `    - ${g}`),
      '',
      '  Fix: add each name to FLEET_CANONICAL_CATALOG_NAMES (or',
      '  OPTIONAL_CATALOG_NAMES if conditional) in',
      '  scripts/repo/sync-scaffolding/manifest/catalog.mts AND pin its version',
      '  in template/base/.config/fleet/pnpm-workspace.fleet.yaml (copy the wheelhouse',
      '  pnpm-workspace.yaml pin verbatim) so loadExpectedCatalogEntries()',
      '  resolves it. A name present in the map but missing from the',
      '  version-source yaml is skipped silently and still counts as a gap.',
      '',
    ].join('\n'),
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`[baseline-catalog-deps-are-covered] error: ${e}`)
    process.exitCode = 1
  })
}
