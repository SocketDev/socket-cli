import { PackageURL, type PurlQualifiers } from '@socketregistry/packageurl-js'
import { isObjectObject } from '@socketsecurity/registry/lib/objects'

import type { SocketArtifact } from './alert/artifact.mts'
import type { PURL_Type } from './ecosystem.mts'

export type PurlObject<T> = T & { type: PURL_Type }

export type PurlLike = string | PackageURL | SocketArtifact

export type CreatePurlObjectOptions = {
  type?: string | undefined
  namespace?: string | undefined
  name?: string | undefined
  version?: string | undefined
  qualifiers?: PurlQualifiers | undefined
  subpath?: string | undefined
  throws?: boolean | undefined
}

export type CreatePurlOptionsWithThrows = CreatePurlObjectOptions & {
  throws?: true | undefined
}

export type CreatePurlOptionsNoThrows = CreatePurlObjectOptions & {
  throws: false
}

export function createPurlObject(
  options: CreatePurlOptionsWithThrows,
): PurlObject<PackageURL>
export function createPurlObject(
  options: CreatePurlOptionsNoThrows,
): PurlObject<PackageURL> | null
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options?: CreatePurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options: CreatePurlOptionsNoThrows,
): PurlObject<PackageURL> | null
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options?: CreatePurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function createPurlObject(
  type: string,
  name: string,
  options: CreatePurlOptionsNoThrows,
): PurlObject<PackageURL> | null
export function createPurlObject(
  type: string,
  name: string,
  options?: CreatePurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  name?: string | CreatePurlObjectOptions | undefined,
  options?: CreatePurlObjectOptions | undefined,
): PurlObject<PackageURL> | null {
  let opts: CreatePurlObjectOptions | undefined
  if (isObjectObject(type)) {
    opts = { __proto__: null, ...type } as CreatePurlObjectOptions
    type = opts.type as string
    name = opts.name as string
  } else if (isObjectObject(name)) {
    opts = { __proto__: null, ...name } as CreatePurlObjectOptions
    name = opts.name as string
  } else {
    opts = { __proto__: null, ...options } as CreatePurlObjectOptions
    if (typeof name !== 'string') {
      name = opts.name as string
    }
  }
  const { namespace, qualifiers, subpath, throws, version } = opts
  const shouldThrow = throws === undefined || !!throws
  try {
    return new PackageURL(
      type,
      namespace,
      name,
      version,
      qualifiers,
      subpath,
    ) as PurlObject<PackageURL>
  } catch (e) {
    if (shouldThrow) {
      throw e
    }
  }
  return null
}

export type PurlObjectOptions = {
  throws?: boolean | undefined
}

export type PurlOptionsWithThrows = PurlObjectOptions & {
  throws?: true | undefined
}

export type PurlOptionsNoThrows = PurlObjectOptions & { throws: false }

export function getPurlObject(
  purl: string,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function getPurlObject(
  purl: string,
  options: PurlOptionsNoThrows,
): PurlObject<PackageURL> | null
export function getPurlObject(
  purl: PackageURL,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function getPurlObject(
  purl: PackageURL,
  options: PurlOptionsNoThrows,
): PurlObject<PackageURL> | null
export function getPurlObject(
  purl: SocketArtifact,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<SocketArtifact>
export function getPurlObject(
  purl: SocketArtifact,
  options: PurlOptionsNoThrows,
): PurlObject<SocketArtifact> | null
export function getPurlObject(
  purl: PurlLike,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<PackageURL | SocketArtifact>
export function getPurlObject(
  purl: PurlLike,
  options?: PurlObjectOptions | undefined,
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
