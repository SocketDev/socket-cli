/**
 * @file Gap #1 engine — catalog-reference-without-entry.
 *   Pure functions, no FS reads, no network. All inputs are strings so the
 *   engine is trivially fixture-testable in vitest.
 *   A workspace package.json may declare `"<dep>": "catalog:"` (or
 *   `"catalog:<named>"`) without a matching entry in the repo's
 *   `pnpm-workspace.yaml` `catalog:` block. pnpm rejects the install with
 *   ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC. This engine finds those gaps
 *   and, when the dep is a known fleet catalog name, produces a fix.
 */

import {
  parseCatalogBlock,
  parseNamedCatalogs,
  spliceCatalogEntry,
} from '../workspace-yaml.mts'

export interface CatalogRef {
  /**
   * The named catalog, e.g. `'react17'`; undefined = default catalog.
   */
  catalogName: string | undefined
  /**
   * The dependency name, e.g. `'rolldown'`.
   */
  dep: string
  /**
   * Workspace-relative path to the file where the reference was found.
   */
  source: string
}

export interface DoctorFinding {
  /**
   * The fix the operator should apply.
   */
  fix: string
  /**
   * True when the doctor can auto-apply the fix with --fix.
   */
  fixable: boolean
  /**
   * What was observed.
   */
  saw: string
  /**
   * Short phrase: what the problem is.
   */
  what: string
  /**
   * The wanted state (what should be present).
   */
  wanted: string
  /**
   * File path where the gap was found.
   */
  where: string
}

/**
 * Section-name patterns that hold dependency specs in a package.json.
 */
const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

/**
 * Scan every workspace package.json + the workspace-yaml overrides block for
 * `catalog:` and `catalog:<named>` dependency specs. Returns the full list of
 * catalog references found.
 */
export function collectCatalogRefs(config: {
  packageJsons: ReadonlyArray<{ content: string; path: string }>
  workspaceYaml: string
}): CatalogRef[] {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const refs: CatalogRef[] = []

  for (const { content, path } of cfg.packageJsons) {
    let pkg: Record<string, unknown>
    try {
      pkg = JSON.parse(content) as Record<string, unknown>
    } catch {
      continue
    }
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section]
      if (!deps || typeof deps !== 'object') {
        continue
      }
      for (const [dep, spec] of Object.entries(
        deps as Record<string, unknown>,
      )) {
        if (typeof spec !== 'string') {
          continue
        }
        if (spec === 'catalog:' || spec === 'catalog:default') {
          refs.push({ catalogName: undefined, dep, source: path })
        } else if (spec.startsWith('catalog:')) {
          const catalogName = spec.slice('catalog:'.length)
          refs.push({ catalogName, dep, source: path })
        }
      }
    }
  }

  // Also scan the `overrides:` block of pnpm-workspace.yaml.
  const overrides = parseCatalogBlock(cfg.workspaceYaml, {
    blockKey: 'overrides',
  })
  for (const [dep, spec] of Object.entries(overrides)) {
    if (spec === 'catalog:' || spec === 'catalog:default') {
      refs.push({
        catalogName: undefined,
        dep,
        source: 'pnpm-workspace.yaml (overrides)',
      })
    } else if (spec.startsWith('catalog:')) {
      const catalogName = spec.slice('catalog:'.length)
      refs.push({
        catalogName,
        dep,
        source: 'pnpm-workspace.yaml (overrides)',
      })
    }
  }

  return refs
}

/**
 * Given the full list of catalog references and the repo's workspace yaml
 * content, identify which default-catalog refs lack an entry in the
 * `catalog:` block. For known fleet names (resolved from the fleet yaml),
 * produce a fixable finding + fix entry. For unknown names, produce a
 * report-only finding with the four-ingredient error format.
 */
export function diagnoseCatalogGaps(config: {
  fleetYaml: string | undefined
  refs: readonly CatalogRef[]
  workspaceYaml: string
}): {
  findings: DoctorFinding[]
  fixes: Array<{ name: string; version: string }>
} {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const findings: DoctorFinding[] = []
  const fixes: Array<{ name: string; version: string }> = []

  const memberCatalog = parseCatalogBlock(cfg.workspaceYaml)
  const memberNamedCatalogs = parseNamedCatalogs(cfg.workspaceYaml)

  // Fleet catalog = `catalog:` ∪ `catalogOptional:` from the fleet yaml.
  let fleetCatalog: Record<string, string> = {}
  if (cfg.fleetYaml === undefined) {
    findings.push({
      fix: 'Re-cascade from the wheelhouse (node scripts/fleet/fetch-fleet-bundle.mts) to restore .config/fleet/pnpm-workspace.fleet.yaml.',
      fixable: false,
      saw: 'file not found at .config/fleet/ (or the pre-relocation repo root)',
      wanted:
        '.config/fleet/pnpm-workspace.fleet.yaml present (cascaded fleet catalog)',
      what: 'Fleet catalog file missing',
      where: '.config/fleet/pnpm-workspace.fleet.yaml',
    })
  } else {
    const fleetMain = parseCatalogBlock(cfg.fleetYaml)
    const fleetOptional = parseCatalogBlock(cfg.fleetYaml, {
      blockKey: 'catalogOptional',
    })
    fleetCatalog = { ...fleetMain, ...fleetOptional }
  }

  // Deduplicate refs by (dep, catalogName) pair to avoid repeated findings
  // when the same dep appears in multiple package.jsons.
  const seen = new Set<string>()

  for (const ref of cfg.refs) {
    const key = `${ref.catalogName ?? ''}\x00${ref.dep}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    if (ref.catalogName !== undefined) {
      // Named-catalog reference — check that the named catalog sub-block exists
      // and has an entry for this dep.
      const namedBlock = memberNamedCatalogs[ref.catalogName]
      if (!namedBlock || !(ref.dep in namedBlock)) {
        findings.push({
          fix: `Add '${ref.dep}': <version> under the 'catalogs: > ${ref.catalogName}:' block in pnpm-workspace.yaml. The fleet doctor does not auto-resolve named-catalog versions.`,
          fixable: false,
          saw: `"${ref.dep}": "catalog:${ref.catalogName}" but catalogs.${ref.catalogName}.${ref.dep} is absent`,
          wanted: `catalogs.${ref.catalogName}.${ref.dep}: <version> in pnpm-workspace.yaml`,
          what: `Named-catalog entry missing: '${ref.dep}' in catalog '${ref.catalogName}'`,
          where: ref.source,
        })
      }
      continue
    }

    // Default-catalog reference.
    if (ref.dep in memberCatalog) {
      continue
    }

    // Missing from the member catalog — look up the fleet version.
    const fleetVersion = fleetCatalog[ref.dep]
    if (!fleetVersion) {
      findings.push({
        fix: `Add '${ref.dep}': <version> to pnpm-workspace.yaml catalog: manually. This dep is not a known fleet catalog name so the doctor cannot resolve a version.`,
        fixable: false,
        saw: `"${ref.dep}": "catalog:" but '${ref.dep}' is absent from both pnpm-workspace.yaml catalog: and pnpm-workspace.fleet.yaml`,
        wanted: `'${ref.dep}': <version> in pnpm-workspace.yaml catalog: block`,
        what: `Unknown catalog dep: '${ref.dep}' has no fleet catalog entry`,
        where: ref.source,
      })
      continue
    }

    // Fixable: we have the fleet version.
    const versionToWrite = fleetVersion.includes(':')
      ? `'${fleetVersion}'`
      : fleetVersion
    findings.push({
      fix: `Add '${ref.dep}': ${versionToWrite} to pnpm-workspace.yaml catalog: (run node scripts/fleet/doctor.mts --fix to apply automatically).`,
      fixable: true,
      saw: `"${ref.dep}": "catalog:" but no '${ref.dep}' entry in the pnpm-workspace.yaml catalog: block`,
      wanted: `'${ref.dep}': ${versionToWrite} in pnpm-workspace.yaml catalog: block`,
      what: `Catalog entry missing: '${ref.dep}' referenced as catalog: but absent from pnpm-workspace.yaml`,
      where: ref.source,
    })
    fixes.push({ name: ref.dep, version: versionToWrite })
  }

  return { findings, fixes }
}

/**
 * Apply catalog fixes to the workspace yaml string by calling
 * spliceCatalogEntry for each fix. Returns the updated content string.
 */
export function applyCatalogFixes(config: {
  fixes: ReadonlyArray<{ name: string; version: string }>
  workspaceYaml: string
}): string {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  let content = cfg.workspaceYaml
  for (const { name, version } of cfg.fixes) {
    content = spliceCatalogEntry(content, name, version)
  }
  return content
}
