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
 * Supported Types: - cargo: Rust packages - gem: Ruby packages - go: Go
 * modules.
 *
 * - Maven: Java packages - npm: Node.js packages - pypi: Python packages.
 *
 * See: https://github.com/package-url/purl-spec.
 */

import { PackageURL } from '@socketregistry/packageurl-js-stable'

import type { SocketArtifact } from '../alert/artifact.mjs'

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
): PackageURL
export function createPurlObject(
  options: CreatePurlOptionsNoThrows,
): PackageURL | undefined
export function createPurlObject(
  type: string,
  options: CreatePurlOptionsNoThrows,
): PackageURL | undefined
export function createPurlObject(
  type: string,
  options?: CreatePurlOptionsWithThrows | undefined,
): PackageURL
export function createPurlObject(
  type: string | CreatePurlObjectOptions,
  options?: CreatePurlObjectOptions | undefined,
): PackageURL | undefined {
  const opts = typeof type === 'string' ? options : type
  const purlType = typeof type === 'string' ? type : type.type
  const { name, namespace, qualifiers, subpath, throws, version } = opts ?? {}
  const shouldThrow = throws === undefined || throws
  try {
    return new PackageURL(
      purlType,
      namespace,
      name,
      version,
      qualifiers,
      subpath,
    )
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
): PackageURL
export function getPurlObject(
  purl: string,
  options: PurlOptionsNoThrows,
): PackageURL | undefined
export function getPurlObject(
  purl: PackageURL,
  options?: PurlOptionsWithThrows | undefined,
): PackageURL
export function getPurlObject(
  purl: PackageURL,
  options: PurlOptionsNoThrows,
): PackageURL | undefined
export function getPurlObject(
  purl: SocketArtifact,
  options?: PurlOptionsWithThrows | undefined,
): SocketArtifact
export function getPurlObject(
  purl: SocketArtifact,
  options: PurlOptionsNoThrows,
): SocketArtifact | undefined
export function getPurlObject(
  purl: PurlLike,
  options?: PurlOptionsWithThrows | undefined,
): PackageURL | SocketArtifact
export function getPurlObject(
  purl: PurlLike,
  options: PurlOptionsNoThrows,
): PackageURL | SocketArtifact | undefined
export function getPurlObject(
  purl: PurlLike,
  options?: PurlObjectOptions | undefined,
): PackageURL | SocketArtifact | undefined {
  const { throws } = { __proto__: null, ...options }
  const shouldThrow = throws === undefined || throws
  try {
    if (typeof purl === 'string') {
      return PackageURL.fromString(normalizePurl(purl))
    }
    return purl
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
