import { PackageURL } from '@socketregistry/packageurl-js'

import type { SocketArtifact } from './alert/artifact.mts'

export function getPurlObject(purl: string | PackageURL | SocketArtifact) {
  return typeof purl === 'string' ? PackageURL.fromString(purl) : purl
}
