/**
 * Classify each referenced package against the manifest's declared surface.
 *
 * Aggregation rule: a package is HARD-needed if it is referenced by at
 * least one UNGUARDED occurrence; it is soft only if EVERY occurrence is
 * guarded (in a try/catch).
 *
 * Ported from nub's `nub-phantom-scan::classify` (jdx/nub, MIT) - AFTER the
 * pnpm#14128 fix: a reference reachable ONLY from the `.d.ts` type surface
 * is unconditionally TypeOnly, never a phantom target, regardless of
 * whether a separate `@types/<pkg>` twin is declared anywhere. Gating that
 * reclassification on a declared twin (nub's original shape, matching
 * pnpm/pnpm#13970's mistake) flagged `@typescript-eslint/types`'s
 * `import type { Program } from 'typescript'` as a HardPhantom, because
 * typescript ships its own types and there is no separate `@types/
 * typescript` package to find. A type-only reference needs nothing at
 * runtime either way, so the gate was simply dropped.
 */

import type { Manifest } from './manifest.mts'
import type { Reference } from './graph.mts'

export type Verdict =
  | 'hard-phantom'
  | 'soft-phantom'
  | 'type-only'
  | 'declared-optional-peer'
  | 'declared-peer'
  | 'declared'
  | 'self-ref'

export interface Agg {
  allSoft: boolean
  fromMain: boolean
  fromSubpath: boolean
  fromTypes: boolean
  specs: string[]
}

export interface Finding {
  package: string
  verdict: Verdict
  soft: boolean
  fromMain: boolean
  fromSubpath: boolean
  fromTypes: boolean
  specifiers: string[]
}

/**
 * Classify all references against `manifest`. Returns one {@link Finding}
 * per distinct referenced package, sorted by package name.
 */
export function classify(
  manifest: Manifest,
  references: readonly Reference[],
): Finding[] {
  const byPackage = new Map<string, Agg>()
  for (let i = 0, { length } = references; i < length; i += 1) {
    const ref = references[i]!
    let agg = byPackage.get(ref.package)
    if (!agg) {
      agg = {
        allSoft: true,
        fromMain: false,
        fromSubpath: false,
        fromTypes: false,
        specs: [],
      }
      byPackage.set(ref.package, agg)
    }
    agg.allSoft &&= ref.soft
    agg.fromMain ||= ref.fromMain
    agg.fromSubpath ||= ref.fromSubpath
    agg.fromTypes ||= ref.fromTypes
    if (!agg.specs.includes(ref.raw)) {
      agg.specs.push(ref.raw)
    }
  }

  const findings: Finding[] = []
  for (const [packageName, agg] of byPackage) {
    const base = verdictFor(manifest, packageName, { allSoft: agg.allSoft })
    const typeSurfaceOnly = agg.fromTypes && !agg.fromMain && !agg.fromSubpath
    const verdict: Verdict =
      typeSurfaceOnly && (base === 'hard-phantom' || base === 'soft-phantom')
        ? 'type-only'
        : base
    findings.push({
      fromMain: agg.fromMain,
      fromSubpath: agg.fromSubpath,
      fromTypes: agg.fromTypes,
      package: packageName,
      soft: agg.allSoft,
      specifiers: agg.specs,
      verdict,
    })
  }

  return findings.toSorted((a, b) => a.package.localeCompare(b.package))
}

export function isSelf(manifest: Manifest, packageName: string): boolean {
  return packageName === manifest.name
}

/**
 * The subpath-adapter class: a HARD phantom reachable ONLY from a non-`.`
 * `exports` subpath (not the main graph) - a `<pkg>/<adapter>` that
 * statically imports a consumer-installed backend it never declares
 * (`@hookform/resolvers/zod` -> `zod`).
 */
export function isSubpathAdapter(finding: Finding): boolean {
  return (
    finding.verdict === 'hard-phantom' &&
    finding.fromSubpath &&
    !finding.fromMain
  )
}

export function verdictFor(
  manifest: Manifest,
  packageName: string,
  config: { allSoft: boolean },
): Verdict {
  const { allSoft } = config
  if (isSelf(manifest, packageName)) {
    return 'self-ref'
  }
  if (manifest.deps.has(packageName) || manifest.bundled.has(packageName)) {
    return 'declared'
  }
  if (manifest.optionalPeers.has(packageName)) {
    return 'declared-optional-peer'
  }
  if (manifest.requiredPeers.has(packageName)) {
    return 'declared-peer'
  }
  return allSoft ? 'soft-phantom' : 'hard-phantom'
}
