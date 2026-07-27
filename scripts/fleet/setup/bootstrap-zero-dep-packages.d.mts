/*
 * @file Hand-authored declarations for bootstrap-zero-dep-packages.mjs — the
 *   dep-0 bootstrap entry stays plain .mjs (it runs before any install exists),
 *   so the typed test surface is declared here.
 */

export declare const FOUNDATION_PACKAGES: readonly string[]

export declare function isDeclaredDependency(
  manifest: Record<string, unknown>,
  pkgName: string,
): boolean

export declare function validateZeroDepManifest(
  manifest: Record<string, unknown>,
  pkgName: string,
  version: string,
): string | undefined

export declare function bootstrapZeroDepPackages(repoRoot: string): boolean
