/**
 * @file Pure planning over a resolved multi-package npm workspace layout
 *   (workspace.mts): version-lockstep drift detection, dependency-aware
 *   publish-order computation (pnpm -r publish's topological semantics),
 *   hollow platform-package detection, and the formatting-preserving lockstep
 *   bump-write planner. Everything here is pure over its inputs (plus
 *   existsSync probes against the real tree for the hollow gate) and
 *   unit-tested against fixture trees; the fs-reading layout resolution lives
 *   in workspace.mts.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import type {
  NpmWorkspaceLayout,
  WorkspaceManifestShape,
  WorkspacePackage,
} from './workspace.mts'

export interface HollowPackageReport {
  missing: string[]
  pkg: WorkspacePackage
}

export interface LockstepWriteInput {
  name: string
  raw: string
  relManifestPath: string
  siblingNames: readonly string[]
}

export interface LockstepWrite {
  relManifestPath: string
  updated: string
}

/**
 * Version-lockstep drift check. Every publishable manifest must read the
 * version source's version, and every exact sibling reference (a bare
 * `X.Y.Z…` spec naming another publishable member — the loader's
 * optionalDependencies rows) must match it too. Returns human-readable drift
 * lines (empty = lockstep holds). Pure over the layout.
 */
export function checkVersionLockstep(layout: NpmWorkspaceLayout): string[] {
  if (layout.kind === 'single') {
    return []
  }
  const { version } = layout.versionSource
  const names = new Set(layout.packages.map(pkg => pkg.name))
  const drift: string[] = []
  for (const pkg of layout.packages) {
    if (pkg.version !== version) {
      drift.push(
        `${pkg.relManifestPath}: version ${pkg.version} != ${version} ` +
          `(the version source, ${layout.versionSource.relManifestPath})`,
      )
    }
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      for (const [depName, spec] of Object.entries(
        pkg.manifest[section] ?? {},
      )) {
        if (names.has(depName) && /^\d/.test(spec) && spec !== version) {
          drift.push(
            `${pkg.relManifestPath}: ${section}["${depName}"] pins ${spec} ` +
              `!= ${version}`,
          )
        }
      }
    }
  }
  return drift
}

/**
 * Dependency-aware publish order over the publishable members —
 * `pnpm -r publish`'s topological semantics, computed here so the staged
 * loop's gates (hollow, already-published, drift) run per package in the
 * order the registry must receive them: a platform package always precedes
 * the loader that optional-depends on it. Kahn's algorithm with a sorted
 * ready set for determinism. Returns the cycle members instead of an order
 * when the workspace dependency graph cannot be ordered. Pure.
 */
export function computePublishOrder(packages: readonly WorkspacePackage[]): {
  cycle: string[] | undefined
  order: WorkspacePackage[]
} {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const dependsOn = new Map<string, Set<string>>()
  for (const pkg of packages) {
    const edges = new Set<string>()
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      const depNames = Object.keys(pkg.manifest[section] ?? {})
      for (let i = 0, { length } = depNames; i < length; i += 1) {
        const depName = depNames[i]!
        if (depName !== pkg.name && byName.has(depName)) {
          edges.add(depName)
        }
      }
    }
    dependsOn.set(pkg.name, edges)
  }
  const order: WorkspacePackage[] = []
  const placed = new Set<string>()
  const names = [...byName.keys()].toSorted()
  while (placed.size < names.length) {
    const ready = names.filter(
      name =>
        !placed.has(name) &&
        [...dependsOn.get(name)!].every(dep => placed.has(dep)),
    )
    if (ready.length === 0) {
      return {
        cycle: names.filter(name => !placed.has(name)),
        order: [],
      }
    }
    for (let i = 0, { length } = ready; i < length; i += 1) {
      placed.add(ready[i]!)
      order.push(byName.get(ready[i]!)!)
    }
  }
  return { cycle: undefined, order }
}

/**
 * The concrete payload files a platform package's manifest declares: the
 * literal (glob-free) `files` entries plus `main`, sorted. The hollow gate
 * requires them on disk pre-publish; the approve-time structural verify
 * requires them inside the staged tarball. Pure.
 */
export function requiredPayloadFiles(
  manifest: WorkspaceManifestShape,
): string[] {
  const required = new Set<string>()
  const files = manifest.files ?? []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const entry = files[i]!
    if (!/[!*?{]/.test(entry)) {
      required.add(entry)
    }
  }
  if (typeof manifest.main === 'string' && manifest.main) {
    required.add(manifest.main)
  }
  return [...required].toSorted()
}

/**
 * Hollow-package detection: a generated platform package whose declared
 * payload is not on disk must NEVER publish (an empty platform package points
 * every consumer install at a broken binary). Required payload = the literal
 * (glob-free) `files` entries plus `main`; a platform manifest declaring no
 * concrete payload at all is reported hollow too — fail loud beats a silent
 * empty tarball. Pure over the discovered packages + the real tree.
 */
export function findHollowPackages(
  packages: readonly WorkspacePackage[],
): HollowPackageReport[] {
  const reports: HollowPackageReport[] = []
  for (const pkg of packages) {
    if (!pkg.platform) {
      continue
    }
    const required = requiredPayloadFiles(pkg.manifest)
    if (required.length === 0) {
      reports.push({
        missing: ['<no concrete payload declared in files/main>'],
        pkg,
      })
      continue
    }
    const missing = required.filter(rel => !existsSync(path.join(pkg.dir, rel)))
    if (missing.length > 0) {
      reports.push({ missing, pkg })
    }
  }
  return reports
}

/**
 * Replace the root `"version"` field in manifest text, preserving the file's
 * existing formatting (a parse → stringify round-trip would reorder keys and
 * reflow the file). Matches the first `"version"` — the root field.
 */
export function replaceManifestVersion(
  raw: string,
  nextVersion: string,
): string {
  return raw.replace(/("version":\s*")[^"]+(")/, `$1${nextVersion}$2`)
}

/**
 * Plan the lockstep bump writes: every manifest's root `version` moves to
 * `nextVersion`, and every exact sibling reference (a bare `X.Y.Z…` spec
 * naming another publishable member) moves with it — `workspace:*` /
 * `catalog:` / `npm:` specs are left alone. Formatting-preserving text
 * replacement; manifests already at `nextVersion` with no stale refs produce
 * no write. Pure — exported for tests; the bump applies the writes and then
 * invokes each declared generator so generated platform dirs re-derive from
 * the bumped main manifest.
 */
export function planLockstepManifestWrites(
  inputs: readonly LockstepWriteInput[],
  nextVersion: string,
): LockstepWrite[] {
  const writes: LockstepWrite[] = []
  for (const input of inputs) {
    let updated = replaceManifestVersion(input.raw, nextVersion)
    for (const sibling of input.siblingNames) {
      if (sibling === input.name) {
        continue
      }
      const escaped = sibling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      updated = updated.replace(
        new RegExp(`("${escaped}":\\s*")\\d[^"]*(")`, 'g'),
        `$1${nextVersion}$2`,
      )
    }
    if (updated !== input.raw) {
      writes.push({ relManifestPath: input.relManifestPath, updated })
    }
  }
  return writes
}
