const GITHUB_ORIGIN = 'https://github.com'

export function integrityValue(integrity: unknown): string {
  if (typeof integrity === 'object' && integrity !== null) {
    const value = (integrity as { readonly value?: unknown | undefined }).value
    return typeof value === 'string' ? value : ''
  }
  return typeof integrity === 'string' ? integrity : ''
}

export function integrityProvenance(integrity: unknown): {
  readonly src: string
  readonly date: string
} {
  if (typeof integrity === 'object' && integrity !== null) {
    const record = integrity as {
      readonly src?: unknown | undefined
      readonly date?: unknown | undefined
    }
    return {
      __proto__: null,
      src: typeof record.src === 'string' ? record.src : '',
      date: typeof record.date === 'string' ? record.date : '',
    } as { readonly src: string; readonly date: string }
  }
  return { __proto__: null, src: '', date: '' } as {
    readonly src: string
    readonly date: string
  }
}

function safeReleaseSegment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    /[/\\?#\u0000-\u0020]/u.test(value)
  ) {
    throw new Error(
      `external-tools.json ${label} is not a safe GitHub release path segment`,
    )
  }
  return value
}

function githubRepositorySlug(repository: unknown): string {
  if (typeof repository !== 'string' || !repository.startsWith('github:')) {
    throw new Error(
      'external-tools.json repository is not a github:owner/repo reference',
    )
  }
  const slug = repository.slice('github:'.length)
  const parts = slug.split('/')
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    parts.some(part => !/^[A-Za-z0-9_.-]+$/u.test(part))
  ) {
    throw new Error(
      'external-tools.json repository is not a github:owner/repo reference',
    )
  }
  return slug
}

export interface ReleaseAssetTool {
  readonly origin?: unknown | undefined
  readonly repository?: unknown | undefined
  readonly tag?: unknown | undefined
  readonly version?: unknown | undefined
}

export interface ReleaseAssetEntry {
  readonly asset?: unknown | undefined
  readonly integrity?: unknown | undefined
}

export interface ResolvedCatalogAsset {
  readonly asset: string
  readonly assetName?: string | undefined
  readonly integrity: string
  readonly repository?: string | undefined
  readonly src: string
  readonly date: string
  readonly tag?: string | undefined
  readonly version: string
}

/**
 * Resolve a pinned GitHub release asset and verify its URL binding.
 */
export function resolveGithubReleaseAsset(
  tool: ReleaseAssetTool,
  entry: ReleaseAssetEntry,
  canonicalKey: string,
): ResolvedCatalogAsset {
  const slug = githubRepositorySlug(tool.repository)
  const tag = safeReleaseSegment(tool.tag, 'tag')
  const assetName = safeReleaseSegment(entry.asset, 'platform asset')
  const pathname = `/${slug}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`
  const asset = new URL(pathname, GITHUB_ORIGIN)
  if (
    asset.origin !== GITHUB_ORIGIN ||
    asset.pathname !== pathname ||
    asset.username ||
    asset.password ||
    asset.search ||
    asset.hash
  ) {
    throw new Error(
      `external-tools.json ${canonicalKey} release asset URL failed GitHub binding validation`,
    )
  }
  const integrity = integrityValue(entry.integrity)
  if (!integrity) {
    throw new Error(
      `external-tools.json ${canonicalKey} entry is missing integrity`,
    )
  }
  const { src, date } = integrityProvenance(entry.integrity)
  return {
    __proto__: null,
    asset: asset.href,
    assetName,
    integrity,
    repository: slug,
    src,
    date,
    tag,
    version: String(tool.version ?? ''),
  } as ResolvedCatalogAsset
}

/**
 * Resolve a catalog asset while preserving its exact integrity metadata.
 */
export function resolveCatalogAsset(
  tool: ReleaseAssetTool,
  entry: ReleaseAssetEntry,
  canonicalKey: string,
): ResolvedCatalogAsset {
  const isGithub =
    tool.origin === 'gh-asset' ||
    (typeof tool.repository === 'string' &&
      tool.repository.startsWith('github:'))
  if (isGithub) {
    return resolveGithubReleaseAsset(tool, entry, canonicalKey)
  }
  const asset = entry.asset
  const integrity = integrityValue(entry.integrity)
  if (typeof asset !== 'string' || !asset.startsWith('https://')) {
    throw new Error(
      `external-tools.json ${canonicalKey} entry is missing an HTTPS asset URL`,
    )
  }
  if (!integrity) {
    throw new Error(
      `external-tools.json ${canonicalKey} entry is missing integrity`,
    )
  }
  const { src, date } = integrityProvenance(entry.integrity)
  return {
    __proto__: null,
    asset,
    integrity,
    src,
    date,
    version: String(tool.version ?? ''),
  } as ResolvedCatalogAsset
}
