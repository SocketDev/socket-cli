/** Type declarations for the generated dependency-free release asset resolver. */

export interface ReleaseAssetEntry {
  readonly asset?: unknown
  readonly integrity?: unknown
}

export interface ReleaseAssetTool {
  readonly origin?: unknown
  readonly repository?: unknown
  readonly tag?: unknown
  readonly version?: unknown
}

export interface PlatformEntry extends ReleaseAssetEntry {
  readonly asset: string
}

export interface ResolvedCatalogAsset {
  readonly asset: string
  readonly assetName?: string
  readonly integrity: string
  readonly repository?: string
  readonly src: string
  readonly date: string
  readonly tag?: string
  readonly version: string
}

export const GO_OS_ARCH: Readonly<Record<string, { readonly os: string; readonly arch: string }>>
export function canonicalPlatformKey(): string
export function integrityProvenance(integrity: unknown): { readonly src: string; readonly date: string }
export function integrityValue(integrity: unknown): string
export function readVersionFromFile(file: string): string
export function resolveCatalogAsset(
  tool: ReleaseAssetTool,
  entry: ReleaseAssetEntry,
  canonicalKey: string,
): ResolvedCatalogAsset
export function resolveGithubReleaseAsset(
  tool: ReleaseAssetTool,
  entry: ReleaseAssetEntry,
  canonicalKey: string,
): ResolvedCatalogAsset
export function resolveGoAssetFromManifest(
  manifest: unknown,
  version: string,
  canonicalKey: string,
): { readonly asset: string; readonly integrity: string; readonly version: string }
export function resolvePlatformEntry(
  platforms: Readonly<Record<string, PlatformEntry>>,
  canonicalKey: string,
): {
  readonly entry: PlatformEntry | undefined
  readonly fallbackKey: string | undefined
}
