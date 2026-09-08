/**
 * @file Type declarations for resolve-external-tool-asset.mjs — the dep-0
 *   bootstrap helper that resolves a pinned external-tool asset URL + SRI
 *   integrity for the runner's canonical platform. The .mjs is intentionally
 *   untyped (it runs before node_modules); this .d.mts mirrors the EXPORTED
 *   helpers so unit tests can import them with type-checking. Keep in step
 *   with the .mjs exports.
 */

export interface GoOsArch {
  readonly os: string
  readonly arch: string
}

// The .mjs uses a __proto__:null object literal keyed by the canonical 8
// platform keys; this Record is the type mirror for a closed domain.
// oxlint-disable-next-line socket/prefer-refined-record -- closed domain
export const GO_OS_ARCH: Readonly<Record<string, GoOsArch>>

export function canonicalPlatformKey(): string

export interface PlatformEntryLike {
  readonly asset: string
  readonly integrity: unknown
}

export interface ResolvedPlatformEntry {
  readonly entry: PlatformEntryLike | undefined
  readonly fallbackKey: string | undefined
}

export function resolvePlatformEntry(
  // oxlint-disable-next-line socket/prefer-refined-record -- closed domain
  platforms: Readonly<Record<string, PlatformEntryLike>>,
  canonicalKey: string,
): ResolvedPlatformEntry

export function integrityValue(integrity: unknown): string

export function integrityProvenance(integrity: unknown): {
  readonly src: string
  readonly date: string
}

export function readVersionFromFile(file: string): string

export interface ResolvedGoAsset {
  readonly asset: string
  readonly integrity: string
  readonly version: string
}

export function resolveGoAssetFromManifest(
  manifest: unknown,
  version: string,
  canonicalKey: string,
): ResolvedGoAsset
