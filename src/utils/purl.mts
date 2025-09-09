import { PackageURL } from '@socketregistry/packageurl-js'

import type { SocketArtifact } from './alert/artifact.mts'
import type { PURL_Type } from './ecosystem.mts'

export type PurlObject<T> = T & { type: PURL_Type }

export type PurlLike = string | PackageURL | SocketArtifact

export type PurlObjectOptions = {
  throws?: boolean | undefined
}

export function getPurlObject(
  purl: string,
  options?: PurlObjectOptions & { throws?: true | undefined },
): PurlObject<PackageURL>
export function getPurlObject(
  purl: string,
  options: PurlObjectOptions & { throws: false },
): PurlObject<PackageURL> | null
export function getPurlObject(
  purl: PackageURL,
  options?: PurlObjectOptions & { throws?: true | undefined },
): PurlObject<PackageURL>
export function getPurlObject(
  purl: PackageURL,
  options: PurlObjectOptions & { throws: false },
): PurlObject<PackageURL> | null
export function getPurlObject(
  purl: SocketArtifact,
  options?: PurlObjectOptions & { throws?: true | undefined },
): PurlObject<SocketArtifact>
export function getPurlObject(
  purl: SocketArtifact,
  options: PurlObjectOptions & { throws: false },
): PurlObject<SocketArtifact> | null
export function getPurlObject(
  purl: PurlLike,
  options?: PurlObjectOptions & { throws?: true | undefined },
): PurlObject<PackageURL | SocketArtifact>
export function getPurlObject(
  purl: PurlLike,
  options?: PurlObjectOptions,
): PurlObject<PackageURL | SocketArtifact> | null {
  const { throws } = { __proto__: null, ...options } as PurlObjectOptions
  const shouldThrow = throws === undefined || !!throws
  try {
    return typeof purl === 'string'
      ? (PackageURL.fromString(purl) as PurlObject<PackageURL>)
      : (purl as PurlObject<PackageURL | SocketArtifact>)
  } catch (e) {
    if (shouldThrow) {
      throw e
    }
    return null
  }
}
