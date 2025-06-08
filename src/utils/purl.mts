import { PackageURL } from '@socketregistry/packageurl-js'

import type { PURL_Type, SocketArtifact } from './alert/artifact.mts'

export function getPurlObject(purl: string): PackageURL & { type: PURL_Type }
export function getPurlObject(
  purl: PackageURL,
): PackageURL & { type: PURL_Type }
export function getPurlObject(
  purl: SocketArtifact,
): SocketArtifact & { type: PURL_Type }
export function getPurlObject(
  purl: string | PackageURL | SocketArtifact,
): (PackageURL | SocketArtifact) & { type: PURL_Type }
export function getPurlObject(
  purl: string | PackageURL | SocketArtifact,
): (PackageURL | SocketArtifact) & { type: PURL_Type } {
  return typeof purl === 'string'
    ? (PackageURL.fromString(purl) as PackageURL & { type: PURL_Type })
    : (purl as (PackageURL | SocketArtifact) & { type: PURL_Type })
}
