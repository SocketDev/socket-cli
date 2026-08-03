/**
 * @file Pure planning over a resolved multi-package npm workspace layout
 *   (workspace.mts): version-lockstep drift detection, dependency-aware
 *   publish-order computation (pnpm -r publish's topological semantics),
 *   absent- and hollow-platform-package detection, and the
 *   formatting-preserving lockstep bump-write planner. Everything here is pure
 *   over its inputs (plus existsSync probes against the real tree for the
 *   hollow gate) and unit-tested against fixture trees; the fs-reading layout
 *   resolution lives in workspace.mts.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import type {
  NpmWorkspaceLayout,
  WorkspaceManifestShape,
  WorkspacePackage,
} from './workspace.mts'

export interface AbsentPlatformPackageReport {
  missing: string[]
  owner: WorkspacePackage
}

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
 * loop's gates, hollow, already-published, drift, run per package in the
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
 * True when the manifest's declared payload carries a machine-built artifact
 * (.wasm / .node). Such a payload has no local byte-twin — it comes from the
 * CI build, and a re-build on a different host/toolchain legitimately differs
 * byte-for-byte — so pre-approve verification must be STRUCTURAL on the
 * staged bytes (verifyStagedPlatformEntry), never a local-pack byte-compare.
 */
export function hasMachineBuiltPayload(
  manifest: WorkspaceManifestShape,
): boolean {
  return requiredPayloadFiles(manifest).some(
    rel => rel.endsWith('.wasm') || rel.endsWith('.node'),
  )
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
 * True when `depName` is one of `ownerName`'s own generated platform siblings:
 * either `@<owner>/<platformId>` (the decmpfs shape — the unscoped loader
 * `decmpfs` owns `@decmpfs/darwin-arm64`) or `<owner>-<platformId>` (the stuie
 * shape — `@stuie/core` owns `@stuie/core-darwin-arm64`). An unrelated
 * third-party optional dependency matches neither, so it is never mistaken for
 * a platform package this repo is expected to ship.
 */
function isPlatformSiblingName(ownerName: string, depName: string): boolean {
  if (depName.startsWith(`${ownerName}-`)) {
    return true
  }
  const scope = ownerName.startsWith('@')
    ? ownerName.slice(1).split('/')[0]!
    : ownerName
  return depName.startsWith(`@${scope}/`)
}

/**
 * Absent-platform-package detection: a loader that DECLARES sibling platform
 * packages in `optionalDependencies` must have every one of them on disk as a
 * real package directory at publish time. An absent directory is invisible to
 * the hollow gate, which can only inspect dirs that exist, yet publishing the
 * loader anyway ships `optionalDependencies` pointing at names that 404 — every
 * consumer install breaks. Repos gitignore their generated `npm/<platformId>/`
 * dirs, so a clean CI checkout has NONE of them until the platform matrix build
 * stages the artifacts; that is exactly the shape this catches.
 *
 * The expected set comes from the loader's own declaration, never from what
 * happens to be on disk: every generator-owning package's exact-version
 * (`X.Y.Z…`) `optionalDependencies` row naming one of its platform siblings.
 * A name the by-convention discovery in workspace.mts already resolved to a
 * package directory is present, its payload is the hollow gate's business;
 * anything left over is missing. Pure over the discovered packages.
 */
export function findAbsentPlatformPackages(
  packages: readonly WorkspacePackage[],
): AbsentPlatformPackageReport[] {
  const discovered = new Set(packages.map(pkg => pkg.name))
  const reports: AbsentPlatformPackageReport[] = []
  for (const owner of packages) {
    if (!owner.generatorPath) {
      continue
    }
    const missing: string[] = []
    for (const [depName, spec] of Object.entries(
      owner.manifest.optionalDependencies ?? {},
    )) {
      if (
        /^\d/.test(spec) &&
        isPlatformSiblingName(owner.name, depName) &&
        !discovered.has(depName)
      ) {
        missing.push(depName)
      }
    }
    if (missing.length > 0) {
      reports.push({ missing: missing.toSorted(), owner })
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
