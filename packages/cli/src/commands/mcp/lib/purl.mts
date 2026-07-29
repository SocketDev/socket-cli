import { PackageURL } from '@socketregistry/packageurl-js-stable'

// Ecosystems where a caller-supplied `1.0.0` is almost always a model default
// standing in for "I don't know the version" rather than a real release. For
// every other ecosystem `1.0.0` is taken at face value — openvsx extensions and
// chrome extensions genuinely publish it.
const PLACEHOLDER_VERSION_ECOSYSTEMS = new Set(['npm', 'pypi'])

/**
 * Build a PURL using packageurl-js for correct encoding across all ecosystems.
 * Handles namespace/name splitting per ecosystem (e.g. npm scoped @scope/name,
 * maven groupId:artifactId, openvsx publisher/extension).
 *
 * The friendly ecosystem name `openvsx` is rewritten to PURL type `vscode` with
 * an auto-added `repository_url=https://open-vsx.org` qualifier, matching the
 * canonical Socket form (e.g.
 * `pkg:vscode/meta/pyrefly@1.0.0?repository_url=...`).
 */
export function buildPurl(
  ecosystem: string,
  depname: string,
  version: string,
  qualifiers?: Record<string, string> | undefined,
): string {
  // `packagist` is the registry name people reach for; the canonical PURL type
  // is `composer`. Alias it so the composer namespace split + lookup apply.
  const rawEcoLower = ecosystem.toLowerCase()
  const ecoLower = rawEcoLower === 'packagist' ? 'composer' : rawEcoLower
  const type = ecoLower === 'openvsx' ? 'vscode' : ecoLower
  let namespace: string | undefined
  let name: string

  if (ecoLower === 'npm' && depname.startsWith('@') && depname.includes('/')) {
    const slash = depname.indexOf('/')
    namespace = depname.slice(0, slash)
    name = depname.slice(slash + 1)
  } else if (
    ecoLower === 'maven' &&
    (depname.includes(':') || depname.includes('/'))
  ) {
    const sep = depname.includes(':') ? ':' : '/'
    const idx = depname.indexOf(sep)
    namespace = depname.slice(0, idx)
    name = depname.slice(idx + 1)
  } else if (ecoLower === 'golang' && depname.includes('/')) {
    const lastSlash = depname.lastIndexOf('/')
    namespace = depname.slice(0, lastSlash)
    name = depname.slice(lastSlash + 1)
  } else if (
    (ecoLower === 'openvsx' || ecoLower === 'vscode') &&
    depname.includes('/')
  ) {
    const slash = depname.indexOf('/')
    namespace = depname.slice(0, slash)
    name = depname.slice(slash + 1)
  } else if (ecoLower === 'composer' && depname.includes('/')) {
    // Composer packages are `vendor/package`; the vendor is the PURL namespace
    // (e.g. `pkg:composer/laravel/framework`). Without this split the vendor
    // folds into the name and the lookup returns no score.
    const slash = depname.indexOf('/')
    namespace = depname.slice(0, slash)
    name = depname.slice(slash + 1)
  } else {
    name = depname
  }

  const merged: Record<string, string> = { ...qualifiers }
  if (ecoLower === 'openvsx' && !merged['repository_url']) {
    merged['repository_url'] = 'https://open-vsx.org'
  }

  const isPlaceholderVersion =
    !version ||
    version === 'unknown' ||
    (version === '1.0.0' && PLACEHOLDER_VERSION_ECOSYSTEMS.has(ecoLower))
  const purlVersion = isPlaceholderVersion ? undefined : version

  const purl = new PackageURL(
    type,
    namespace,
    name,
    purlVersion,
    Object.keys(merged).length ? merged : undefined,
    undefined,
  )
  return purl.toString()
}
