/*
 * @file Hand-authored declarations for bootstrap-pnpm.mjs — the decision
 *   core stays plain .mjs because the fleet setup action runs it on the
 *   runner's system Node before any install exists, so the typed test surface
 *   is declared here.
 */

export declare function npmVersionManifestUrl(
  pkgName: string,
  version: string,
): string

export declare function npmPackumentUrl(pkgName: string): string

export interface NpmDist {
  integrity: string
  tarball: string
}

export declare function extractNpmDist(manifest: unknown): NpmDist | undefined

export type SemverTriple = readonly [number, number, number]

export declare function parseSemverTriple(
  version: string | undefined,
): SemverTriple | undefined

export declare function compareSemverTriples(
  a: SemverTriple,
  b: SemverTriple,
): number

export type SemverComparatorOp = '=' | '<' | '<=' | '>' | '>='

export interface SemverComparator {
  op: SemverComparatorOp
  triple: SemverTriple
}

export declare function parseSemverComparator(
  token: string | undefined,
): SemverComparator | undefined

export declare function parseSemverRange(
  range: string | undefined,
): SemverComparator[] | undefined

export declare function satisfiesSemverRange(
  triple: SemverTriple,
  comparators: readonly SemverComparator[],
): boolean

export declare function resolveHighestSatisfying(
  range: string | undefined,
  versions: readonly string[],
): string | undefined
