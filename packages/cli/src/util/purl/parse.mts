/**
 * Package URL (PURL) utilities for Socket CLI. Implements the PURL
 * specification for universal package identification.
 *
 * PURL Format: pkg:type/namespace/name@version?qualifiers#subpath.
 *
 * Key Functions: - createPurlObject: Create PURL from components - isPurl:
 * Check if string is valid PURL - normalizePurl: Normalize PURL format -
 * parsePurl: Parse PURL string to object - purlToString: Convert PURL object to
 * string.
 *
 * Supported Types: - cargo: Rust packages - gem: Ruby packages - go: Go modules
 * - maven: Java packages - npm: Node.js packages - pypi: Python packages.
 *
 * See: https://github.com/package-url/purl-spec.
 */

import { PackageURL } from '@socketregistry/packageurl-js-stable'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import type { SocketArtifact } from '../alert/artifact.mjs'
import type { PURL_Type } from '../ecosystem/types.mjs'

export type PurlObject<T> = T & { type: PURL_Type }

export type PurlLike = string | PackageURL | SocketArtifact

export type CreatePurlObjectOptions = {
  type?: string | undefined
  namespace?: string | undefined
  name?: string | undefined
  version?: string | undefined
  qualifiers?: Record<string, string> | undefined
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
): PurlObject<PackageURL> | undefined
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options?: CreatePurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options: CreatePurlOptionsNoThrows,
): PurlObject<PackageURL> | undefined
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options?: CreatePurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function createPurlObject(
  type: string,
  name: string,
  options: CreatePurlOptionsNoThrows,
): PurlObject<PackageURL> | undefined
export function createPurlObject(
  type: string,
  name: string,
  options?: CreatePurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  name?: string | CreatePurlObjectOptions | undefined,
  options?: CreatePurlObjectOptions | undefined,
): PurlObject<PackageURL> | undefined {
  let opts: CreatePurlObjectOptions | undefined
  // The PackageURL constructor takes `unknown` components and validates at
  // runtime, so a missing `type` flows through to its own error handling.
  let purlType: string | undefined
  if (isPlainObject(type)) {
    opts = { __proto__: null, ...type } as CreatePurlObjectOptions
    purlType = opts.type
    name = opts.name
  } else {
    purlType = type
    if (isPlainObject(name)) {
      opts = { __proto__: null, ...name } as CreatePurlObjectOptions
      name = opts.name
    } else {
      opts = { __proto__: null, ...options } as CreatePurlObjectOptions
      if (typeof name !== 'string') {
        name = opts.name
      }
    }
  }
  const { namespace, qualifiers, subpath, throws, version } = opts
  const shouldThrow = throws === undefined || throws
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- brand cast: the constructor validates the type component against the purl spec at runtime, but packageurl-js types the field as a plain string rather than the known-ecosystem PURL_Type union.
    return new PackageURL(
      purlType,
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
  return undefined
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
): PurlObject<PackageURL> | undefined
export function getPurlObject(
  purl: PackageURL,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<PackageURL>
export function getPurlObject(
  purl: PackageURL,
  options: PurlOptionsNoThrows,
): PurlObject<PackageURL> | undefined
export function getPurlObject(
  purl: SocketArtifact,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<SocketArtifact>
export function getPurlObject(
  purl: SocketArtifact,
  options: PurlOptionsNoThrows,
): PurlObject<SocketArtifact> | undefined
export function getPurlObject(
  purl: PurlLike,
  options?: PurlOptionsWithThrows | undefined,
): PurlObject<PackageURL | SocketArtifact>
export function getPurlObject(
  purl: PurlLike,
  options?: PurlObjectOptions | undefined,
): PurlObject<PackageURL | SocketArtifact> | undefined {
  const { throws } = { __proto__: null, ...options } as PurlObjectOptions
  const shouldThrow = throws === undefined || throws
  try {
    // The casts brand the parser's `type: string` as the known-ecosystem
    // PURL_Type union — packageurl-js validates the type component against the
    // purl spec at construction, but its typings keep the field a plain string.
    if (typeof purl === 'string') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- brand cast, see above.
      return PackageURL.fromString(
        normalizePurl(purl),
      ) as PurlObject<PackageURL>
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- brand cast, see above.
    return purl as PurlObject<PackageURL | SocketArtifact>
  } catch (e) {
    if (shouldThrow) {
      throw e
    }
    return undefined
  }
}

export function normalizePurl(rawPurl: string): string {
  return rawPurl.startsWith('pkg:') ? rawPurl : `pkg:${rawPurl}`
}
