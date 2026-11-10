/**
 * Package URL (PURL) utilities for Socket CLI.
 * Implements the PURL specification for universal package identification.
 *
 * PURL Format:
 * pkg:type/namespace/name@version?qualifiers#subpath
 *
 * Key Functions:
 * - createPurlObject: Create PURL from components
 * - isPurl: Check if string is valid PURL
 * - normalizePurl: Normalize PURL format
 * - parsePurl: Parse PURL string to object
 * - purlToString: Convert PURL object to string
 *
 * Supported Types:
 * - cargo: Rust packages
 * - gem: Ruby packages
 * - go: Go modules
 * - maven: Java packages
 * - npm: Node.js packages
 * - pypi: Python packages
 *
 * See: https://github.com/package-url/purl-spec
 */

import { builtinModules } from 'node:module'

import { isObjectObject } from './objects.mts'
import legacyNpmData from './purl-legacy-npm-names.json' with { type: 'json' }

import type { SocketArtifact } from './alert/artifact.mts'
import type { PURL_Type } from './ecosystem.mts'

export type PurlObject<T> = T & { type: PURL_Type }

export type PurlQualifiers = Record<string, string>

/**
 * Minimal PackageURL implementation used by the CLI.
 *
 * Adapted from @socketregistry/packageurl-js 1.0.9, src/package-url.js,
 * src/normalize.js, src/encode.js, src/decode.js, and the corresponding
 * component validation helpers. Copyright (c) the purl authors.
 * The upstream MIT license notice and terms are reproduced below.
 */
export class PackageURL {
  type: string
  name: string
  namespace: string | undefined
  version: string | undefined
  qualifiers: PurlQualifiers | undefined
  subpath: string | undefined

  constructor(
    rawType: string,
    rawNamespace?: string,
    rawName?: string,
    rawVersion?: string,
    rawQualifiers?:
      | PurlQualifiers
      | URLSearchParams
      | Map<string, unknown>
      | string,
    rawSubpath?: string,
  ) {
    this.type = (
      typeof rawType === 'string' ? rawType.trim().toLowerCase() : rawType
    ) as string
    this.name = (
      typeof rawName === 'string' ? rawName.trim() : rawName
    ) as string
    this.namespace = (
      typeof rawNamespace === 'string'
        ? normalizePath(rawNamespace)
        : (rawNamespace ?? undefined)
    ) as string | undefined
    this.version = (
      typeof rawVersion === 'string'
        ? rawVersion.trim() || undefined
        : (rawVersion ?? undefined)
    ) as string | undefined
    this.qualifiers = (
      rawQualifiers == null
        ? undefined
        : typeof rawQualifiers === 'string' || typeof rawQualifiers === 'object'
          ? normalizeQualifiers(rawQualifiers)
          : rawQualifiers
    ) as PurlQualifiers | undefined
    this.subpath = (
      typeof rawSubpath === 'string'
        ? normalizeSubpath(rawSubpath)
        : (rawSubpath ?? undefined)
    ) as string | undefined
    validatePurlComponents(this)
    normalizePurlType(this)
    validatePurl(this)
  }

  toString(): string {
    let result = `pkg:${encodeURIComponent(this.type)}/`
    if (this.namespace) {
      result += `${encodeNamespace(this.namespace)}/`
    }
    result += encodeURIComponent(this.name).replaceAll('%3A', ':')
    if (this.version) {
      result += `@${encodeURIComponent(this.version).replaceAll('%3A', ':')}`
    }
    if (this.qualifiers) {
      result += `?${encodeQualifiers(this.qualifiers)}`
    }
    if (this.subpath) {
      result += `#${encodeURIComponent(this.subpath).replaceAll('%2F', '/')}`
    }
    return result
  }

  static fromString(input: string): PackageURL {
    if (typeof input !== 'string') {
      throw new Error('A purl string argument is required.')
    }
    if (!input.trim()) {
      throw new Error('Invalid purl: "type" is a required component')
    }
    let url: URL
    let authorityUrl: URL
    try {
      const colon = input.indexOf(':')
      const afterColon = input.slice(colon + 1)
      const stripped = afterColon.replace(/^\/+/, '')
      url = new URL(`${input.slice(0, colon)}:${stripped}`)
      authorityUrl =
        stripped.length === afterColon.length ? url : new URL(input)
    } catch (cause) {
      throw new Error('Invalid purl: failed to parse as URL', { cause })
    }
    if (url.protocol !== 'pkg:') {
      throw new Error('Invalid purl: missing required "pkg" scheme component')
    }
    if (authorityUrl.username || authorityUrl.password) {
      throw new Error('Invalid purl: cannot contain a "user:pass@host:port"')
    }
    const path = url.pathname
    const slash = path.indexOf('/')
    const type = decodePurl('type', slash === -1 ? path : path.slice(0, slash))
    if (slash < 1) {
      return new PackageURL(type)
    }
    let at =
      type === 'npm' ? path.indexOf('@', slash + 2) : path.lastIndexOf('@')
    if (at !== -1 && path.charCodeAt(at - 1) === 47) {
      at = -1
    }
    const beforeVersion = path.slice(
      type.length + 1,
      at === -1 ? path.length : at,
    )
    const version =
      at === -1 ? undefined : decodePurl('version', path.slice(at + 1))
    const lastSlash = beforeVersion.lastIndexOf('/')
    const namespace =
      lastSlash === -1
        ? undefined
        : decodePurl('namespace', beforeVersion.slice(0, lastSlash))
    const name = decodePurl(
      'name',
      lastSlash === -1 ? beforeVersion : beforeVersion.slice(lastSlash + 1),
    )
    let qualifiers: PurlQualifiers | undefined
    if (url.searchParams.size !== 0) {
      const searchParams = new URLSearchParams()
      const entries = url.search.slice(1).split('&')
      for (const entry of entries) {
        const pairs = entry.split('=')
        const value = decodePurl('qualifiers', pairs[1] ?? '')
        // Append keeps literal plus signs in decoded values; URLSearchParams
        // would otherwise interpret them as spaces when parsing the query.
        searchParams.append(pairs[0] ?? '', value)
      }
      qualifiers = searchParams as unknown as PurlQualifiers
    }
    const subpath = url.hash
      ? decodePurl('subpath', url.hash.slice(1))
      : undefined
    return new PackageURL(type, namespace, name, version, qualifiers, subpath)
  }
}

function decodePurl(component: string, value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`Invalid purl: unable to decode "${component}" component`)
  }
}

function normalizePath(
  value?: string,
  filter?: (part: string) => boolean,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const parts = value
    .split('/')
    .filter(
      part =>
        part && part !== '.' && part !== '..' && (!filter || filter(part)),
    )
  return parts.join('/')
}

function normalizeSubpath(value?: string): string | undefined {
  return normalizePath(
    value,
    part => part !== '.' && part !== '..' && !!part.trim(),
  )
}

function normalizeQualifiers(
  value?: PurlQualifiers | URLSearchParams | Map<string, unknown> | string,
): PurlQualifiers | undefined {
  let entries: Iterable<[string, unknown]>
  if (typeof value === 'string') {
    entries = new URLSearchParams(value).entries()
  } else if (value && typeof value === 'object') {
    const entriesMethod = (
      value as { entries?: () => Iterable<[string, unknown]> }
    ).entries
    entries =
      typeof entriesMethod === 'function'
        ? entriesMethod.call(value)
        : Object.entries(value)
  } else {
    entries = []
  }
  const result: PurlQualifiers = Object.create(null)
  for (const [key, raw] of entries) {
    const normalized = String(raw).trim()
    if (normalized) {
      result[key.toLowerCase()] = normalized
    }
  }
  return Object.keys(result).length ? result : undefined
}

function encodeNamespace(value: string): string {
  return encodeURIComponent(value).replaceAll('%3A', ':').replaceAll('%2F', '/')
}

function encodeQualifiers(value: PurlQualifiers): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(value).sort()) {
    params.set(key, value[key]!.replaceAll(' ', '%20'))
  }
  return params.toString().replaceAll('%2520', '%20').replaceAll('+', '%2B')
}

function normalizePurlType(purl: PackageURL): void {
  const lowerNameAndNamespace = new Set([
    'alpm',
    'apk',
    'bitbucket',
    'composer',
    'deb',
    'github',
    'gitlab',
    'hex',
  ])
  if (lowerNameAndNamespace.has(purl.type)) {
    purl.name = purl.name.toLowerCase()
    if (purl.namespace) {
      purl.namespace = purl.namespace.toLowerCase()
    }
  } else if (purl.type === 'npm') {
    if (purl.namespace) {
      purl.namespace = purl.namespace.toLowerCase()
    }
    // npm has a large historical allowlist of mixed-case/otherwise-invalid
    // names. Preserve those names; modern package names are lowercase.
    if (!isLegacyNpmName(purl.namespace, purl.name)) {
      purl.name = purl.name.toLowerCase()
    }
  } else if (purl.type === 'pypi') {
    if (purl.namespace) {
      purl.namespace = purl.namespace.toLowerCase()
    }
    purl.name = purl.name.toLowerCase().replaceAll('_', '-')
  } else if (
    purl.type === 'bitnami' ||
    purl.type === 'oci' ||
    purl.type === 'pub'
  ) {
    purl.name = purl.name.toLowerCase()
    if (purl.type === 'pub') {
      purl.name = purl.name.replaceAll('-', '_')
    }
  } else if (purl.type === 'luarocks' || purl.type === 'huggingface') {
    if (purl.version) {
      purl.version = purl.version.toLowerCase()
    }
  } else if (
    purl.type === 'mlflow' &&
    purl.qualifiers?.['repository_url']?.includes('databricks')
  ) {
    purl.name = purl.name.toLowerCase()
  } else if (purl.type === 'qpkg' || purl.type === 'rpm') {
    if (purl.namespace) {
      purl.namespace = purl.namespace.toLowerCase()
    }
  }
}

function validatePurl(purl: PackageURL): void {
  validatePurlComponents(purl)
  switch (purl.type) {
    case 'conan':
      if (purl.qualifiers?.['channel'] && !purl.namespace) {
        throw new Error(
          'Invalid purl: conan requires a "namespace" component when a "channel" qualifier is present',
        )
      }
      if (purl.namespace && !purl.qualifiers) {
        throw new Error(
          'Invalid purl: conan requires a "qualifiers" component when a namespace is present',
        )
      }
      break
    case 'cran':
      if (!purl.version) {
        throw new Error('Invalid purl: cran requires a "version" component')
      }
      break
    case 'golang':
      if (purl.version?.startsWith('v') && !isSemver(purl.version.slice(1))) {
        throw new Error(
          'Invalid purl: golang "version" component starting with a "v" must be followed by a valid semver version',
        )
      }
      break
    case 'maven':
      if (!purl.namespace) {
        throw new Error('Invalid purl: maven requires a "namespace" component')
      }
      break
    case 'swift':
      if (!purl.namespace) {
        throw new Error('Invalid purl: swift requires a "namespace" component')
      }
      if (!purl.version) {
        throw new Error('Invalid purl: swift requires a "version" component')
      }
      break
    case 'mlflow':
    case 'oci':
      if (purl.namespace) {
        throw new Error(
          `Invalid purl: ${purl.type} "namespace" component must be empty`,
        )
      }
      break
    case 'pub':
      if (!/^[a-z0-9_]+$/.test(purl.name)) {
        throw new Error(
          'Invalid purl: pub "name" component may only contain [a-z0-9_] characters',
        )
      }
      break
    case 'npm':
      validateNpm(purl)
      break
  }
}

function validatePurlComponents(purl: PackageURL): void {
  if (
    typeof purl.type !== 'string' ||
    !purl.type ||
    !/^[A-Za-z][A-Za-z0-9.-]*$/.test(purl.type)
  ) {
    throw new Error(
      'Invalid purl: type is required and must contain only letters, numbers, "." and "-"',
    )
  }
  if (typeof purl.name !== 'string' || !purl.name) {
    throw new Error('Invalid purl: "name" is a required component')
  }
  for (const [component, value] of [
    ['namespace', purl.namespace],
    ['name', purl.name],
    ['version', purl.version],
    ['subpath', purl.subpath],
  ] as const) {
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`Invalid purl: "${component}" must be a string`)
    }
  }
  if (purl.qualifiers !== undefined && typeof purl.qualifiers !== 'object') {
    throw new Error('Invalid purl: "qualifiers" must be an object')
  }
  for (const key of Object.keys(purl.qualifiers ?? {})) {
    if (!/^[A-Za-z_.-][A-Za-z0-9._-]*$/.test(key)) {
      throw new Error(
        `Invalid purl: qualifier "${key}" contains an illegal character`,
      )
    }
  }
}

function isSemver(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/.test(
    value,
  )
}

function isLegacyNpmName(namespace: string | undefined, name: string): boolean {
  const id = `${namespace ? `${namespace}/` : ''}${name}`
  return legacyNpmData.names.includes(id)
}

function validateNpm(purl: PackageURL): void {
  const { name, namespace } = purl
  const id = `${namespace ? `${namespace}/` : ''}${name}`
  const leading = namespace || name
  if (leading.startsWith('.') || leading.startsWith('_')) {
    throw new Error(
      `Invalid purl: npm "${namespace ? 'namespace' : 'name'}" component cannot start with ${leading.startsWith('.') ? 'a period' : 'an underscore'}`,
    )
  }
  if (name.trim() !== name || namespace?.trim() !== namespace) {
    throw new Error(
      'Invalid purl: npm components cannot contain leading or trailing spaces',
    )
  }
  if (namespace && !namespace.startsWith('@')) {
    throw new Error(
      'Invalid purl: npm "namespace" component must start with an "@" character',
    )
  }
  if (encodeURIComponent(name) !== name) {
    throw new Error(
      'Invalid purl: npm "name" component can only contain URL-friendly characters',
    )
  }
  if (
    namespace &&
    encodeURIComponent(namespace.slice(1)) !== namespace.slice(1)
  ) {
    throw new Error(
      'Invalid purl: npm "namespace" component can only contain URL-friendly characters',
    )
  }
  const lowered = id.toLowerCase()
  if (lowered === 'node_modules' || lowered === 'favicon.ico') {
    throw new Error(
      `Invalid purl: npm component of "${lowered}" is not allowed`,
    )
  }
  if (isLegacyNpmName(namespace, name)) {
    return
  }
  if (id.length > 214) {
    throw new Error(
      'Invalid purl: npm "namespace" and "name" components can not collectively be more than 214 characters',
    )
  }
  if (lowered !== id) {
    throw new Error(
      'Invalid purl: npm "name" component can not contain capital letters',
    )
  }
  if (/[~'!()*]/.test(name)) {
    throw new Error(
      'Invalid purl: npm "name" component can not contain special characters ("~\'!()*")',
    )
  }
  if (
    new Set(
      builtinModules.map(moduleName => moduleName.replace(/^node:/, '')),
    ).has(lowered)
  ) {
    throw new Error(
      'Invalid purl: npm "name" component can not be a core module name',
    )
  }
}

/*
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

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
  const shouldThrow = throws === undefined || !!throws
  try {
    return typeof purl === 'string'
      ? (PackageURL.fromString(normalizePurl(purl)) as PurlObject<PackageURL>)
      : (purl as PurlObject<PackageURL | SocketArtifact>)
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
