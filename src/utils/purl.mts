import { PackageURL } from '@socketregistry/packageurl-js'

export function getPurlObject(purl: string | PackageURL) {
  return typeof purl === 'string' ? PackageURL.fromString(purl) : purl
}
