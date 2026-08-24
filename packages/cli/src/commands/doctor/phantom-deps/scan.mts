/**
 * Scan a project's DIRECT dependencies (as installed in `node_modules`) for
 * phantom dependencies: a static import a dep's published code makes that
 * its own `package.json` does not declare. Under npm's flat layout this
 * resolves by accident, since everything gets hoisted to the top; under a
 * strict resolver (pnpm's virtual store, an isolated install) it breaks.
 *
 * Scoped to DIRECT deps only, one level deep - the same scope
 * `nub-phantom-scan`'s dynamic per-version detector runs at, and the scope
 * that matters for socket doctor: a transitive phantom is the transitive
 * dep's own maintainer's problem, surfaced when doctor is run against that
 * package's own repo.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { classify } from './classify.mts'
import { walk } from './graph.mts'
import { parseManifest } from './manifest.mts'

import type { Finding } from './classify.mts'

export interface PhantomDepFinding {
  /**
   * The direct dependency whose published code carries the phantom import.
   */
  importer: string
  target: string
  specifiers: string[]
  isSubpathAdapter: boolean
}

export function declaredDependencyNames(
  rootPkg: Record<string, unknown>,
): string[] {
  const names = new Set<string>()
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies']
  for (let i = 0, { length } = fields; i < length; i += 1) {
    const value = rootPkg[fields[i]!]
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value as Record<string, unknown>)
      for (let j = 0, jlen = keys.length; j < jlen; j += 1) {
        names.add(keys[j]!)
      }
    }
  }
  return [...names]
}

/**
 * Scan every direct dependency of the project rooted at `root` for phantom
 * imports. Returns one finding per (importer, phantom target) pair with a
 * HARD verdict - `type-only`, `soft-phantom`, and every declared verdict are
 * excluded by design, matching nub's corrected classifier.
 */
export function scanPhantomDependencies(root: string): PhantomDepFinding[] {
  const rootPkgPath = path.join(root, 'package.json')
  if (!existsSync(rootPkgPath)) {
    return []
  }
  let rootPkg: Record<string, unknown>
  try {
    rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return []
  }

  const findings: PhantomDepFinding[] = []
  const directDeps = declaredDependencyNames(rootPkg)
  const rootDeps = new Set(directDeps)
  const nodeModules = path.join(root, 'node_modules')

  for (let i = 0, { length } = directDeps; i < length; i += 1) {
    const depName = directDeps[i]!
    const depDir = path.join(
      nodeModules,
      ...(depName.startsWith('@') ? depName.split('/') : [depName]),
    )
    const depPkgPath = path.join(depDir, 'package.json')
    if (!existsSync(depPkgPath)) {
      continue
    }
    let raw: string
    try {
      raw = readFileSync(depPkgPath, 'utf8')
    } catch {
      continue
    }
    const manifest = parseManifest(raw)
    if (!manifest) {
      continue
    }

    const walked = walk(depDir, manifest.entryPoints)
    const findingsForDep: Finding[] = classify(manifest, walked.references)

    for (let j = 0, jlen = findingsForDep.length; j < jlen; j += 1) {
      const finding = findingsForDep[j]!
      // Already declared at the project root - the flat layout resolves it
      // the same way a direct root dependency does, so it is not phantom
      // from the consumer's perspective even if this dep's OWN manifest
      // does not declare it (a monorepo-hoisted sibling, for example).
      if (rootDeps.has(finding.package)) {
        continue
      }
      if (finding.verdict !== 'hard-phantom') {
        continue
      }
      findings.push({
        importer: depName,
        isSubpathAdapter:
          finding.verdict === 'hard-phantom' &&
          finding.fromSubpath &&
          !finding.fromMain,
        specifiers: finding.specifiers,
        target: finding.package,
      })
    }
  }

  return findings
}
