/**
 * @file Gap #11 engine — direct pin shadowing a catalog entry.
 *   Pure functions, no FS reads, no network. All inputs are strings so the
 *   engine is trivially fixture-testable in vitest.
 *   A workspace package.json may pin `"<dep>": "1.2.3"` while the repo's
 *   `pnpm-workspace.yaml` `catalog:` block carries the same dep. The direct
 *   pin wins, so every catalog bump silently no-ops for that dep — the repo
 *   installs a stale version while the catalog (and the fleet cascade that
 *   maintains it) reports current. Incident: socket-sdk-js ran oxfmt 0.48
 *   against a 0.57 catalog entry, failing format checks on files the
 *   wheelhouse formatted cleanly. The fix rewrites the pin to `catalog:`.
 *   Deliberate off-catalog pins opt out via a `catalogShadowIgnore:` list in
 *   pnpm-workspace.yaml.
 */

import { parseCatalogBlock, parseListBlock } from '../workspace-yaml.mts'

import type { DoctorFinding } from './catalog-gap.mts'

export interface PinShadowFix {
  /**
   * Dep names in this file to rewrite to `catalog:`.
   */
  deps: string[]
  /**
   * Workspace-relative path of the package.json to rewrite.
   */
  path: string
}

/**
 * Sections whose specs install directly and therefore shadow the catalog.
 * peerDependencies is excluded: peer ranges are published compatibility
 * contracts, not install pins, and must stay explicit.
 */
const SHADOWABLE_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
] as const

/**
 * Spec prefixes that are deliberate non-registry targets — rewriting one to
 * `catalog:` would change semantics, not just the version source.
 */
const NON_REGISTRY_SPEC =
  /^(?:catalog:|file:|git|https?:|link:|npm:|workspace:)/

/**
 * Find every package.json dep whose direct version spec shadows an entry in
 * the member `catalog:` block. Returns report findings plus per-file fix
 * plans (applied by applyPinShadowFixes under --fix).
 */
export function diagnosePinShadowGaps(config: {
  packageJsons: ReadonlyArray<{ content: string; path: string }>
  workspaceYaml: string
}): {
  findings: DoctorFinding[]
  fixes: PinShadowFix[]
} {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const findings: DoctorFinding[] = []
  const fixes: PinShadowFix[] = []

  const memberCatalog = parseCatalogBlock(cfg.workspaceYaml)
  const ignored = new Set(
    parseListBlock(cfg.workspaceYaml, { blockKey: 'catalogShadowIgnore' }),
  )

  for (const { content, path } of cfg.packageJsons) {
    let pkg: Record<string, unknown>
    try {
      pkg = JSON.parse(content) as Record<string, unknown>
    } catch {
      continue
    }
    const fileDeps: string[] = []
    for (const section of SHADOWABLE_SECTIONS) {
      const deps = pkg[section]
      if (!deps || typeof deps !== 'object') {
        continue
      }
      for (const [dep, spec] of Object.entries(
        deps as Record<string, unknown>,
      )) {
        if (typeof spec !== 'string' || NON_REGISTRY_SPEC.test(spec)) {
          continue
        }
        if (!(dep in memberCatalog) || ignored.has(dep)) {
          continue
        }
        findings.push({
          fix: `Rewrite to "${dep}": "catalog:" (run node scripts/fleet/doctor.mts --fix to apply automatically), or add '${dep}' to a catalogShadowIgnore: list in pnpm-workspace.yaml if the off-catalog pin is deliberate.`,
          fixable: true,
          saw: `${section}.${dep} pinned at "${spec}" while the catalog carries ${memberCatalog[dep]}`,
          wanted: `"${dep}": "catalog:" so the pnpm-workspace.yaml catalog entry governs the installed version`,
          what: `Direct pin shadows catalog entry: '${dep}'`,
          where: path,
        })
        if (!fileDeps.includes(dep)) {
          fileDeps.push(dep)
        }
      }
    }
    if (fileDeps.length > 0) {
      fixes.push({ deps: fileDeps, path })
    }
  }

  return { findings, fixes }
}

/**
 * Rewrite the given deps to `catalog:` in a package.json content string.
 * Parses and re-serializes (2-space indent, trailing newline — the fleet
 * package.json shape) so a dep name appearing in overrides or scripts text
 * is never touched by accident.
 */
export function applyPinShadowFixes(config: {
  content: string
  deps: readonly string[]
}): string {
  const cfg = Object.assign(Object.create(null), config) as typeof config
  const pkg = JSON.parse(cfg.content) as Record<string, unknown>
  for (const section of SHADOWABLE_SECTIONS) {
    const deps = pkg[section]
    if (!deps || typeof deps !== 'object') {
      continue
    }
    const record = deps as Record<string, unknown>
    for (const dep of cfg.deps) {
      if (
        typeof record[dep] === 'string' &&
        !NON_REGISTRY_SPEC.test(record[dep] as string)
      ) {
        record[dep] = 'catalog:'
      }
    }
  }
  return `${JSON.stringify(pkg, undefined, 2)}\n`
}
