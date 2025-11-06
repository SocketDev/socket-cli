/**
 * @fileoverview Package.json normalization utilities.
 */

import { merge } from '../objects'

import type { NormalizeOptions, PackageJson } from '../packages'

const ArrayIsArray = Array.isArray
const ObjectHasOwn = Object.hasOwn

// Lazy load constants to avoid circular dependencies.
let _REGISTRY_SCOPE_DELIMITER: string | undefined
function getRegistryScopeDelimiter(): string {
  if (_REGISTRY_SCOPE_DELIMITER === undefined) {
    _REGISTRY_SCOPE_DELIMITER =
      /*@__INLINE__*/ require('../constants/socket').REGISTRY_SCOPE_DELIMITER
  }
  return _REGISTRY_SCOPE_DELIMITER as string
}

let _SOCKET_REGISTRY_SCOPE: string | undefined
function getSocketRegistryScope(): string {
  if (_SOCKET_REGISTRY_SCOPE === undefined) {
    _SOCKET_REGISTRY_SCOPE =
      /*@__INLINE__*/ require('../constants/socket').SOCKET_REGISTRY_SCOPE
  }
  return _SOCKET_REGISTRY_SCOPE as string
}

let _escapeRegExp: ((s: string) => string) | undefined
function getEscapeRegExp(): (s: string) => string {
  if (_escapeRegExp === undefined) {
    _escapeRegExp = /*@__PURE__*/ require('../regexps').escapeRegExp
  }
  return _escapeRegExp as (s: string) => string
}

function getEscapedScopeRegExp(): RegExp {
  const REGISTRY_SCOPE_DELIMITER = getRegistryScopeDelimiter()
  const escapeRegExp = getEscapeRegExp()
  const firstChar = REGISTRY_SCOPE_DELIMITER[0] as string
  return new RegExp(
    `^[^${escapeRegExp(firstChar)}]+${escapeRegExp(REGISTRY_SCOPE_DELIMITER)}(?!${escapeRegExp(firstChar)})`,
  )
}

let _normalizePackageData: typeof import('normalize-package-data') | undefined
/**
 * Get the normalize-package-data module.
 */
/*@__NO_SIDE_EFFECTS__*/
function getNormalizePackageData() {
  if (_normalizePackageData === undefined) {
    _normalizePackageData =
      /*@__PURE__*/ require('normalize-package-data')
  }
  return _normalizePackageData as typeof import('normalize-package-data')
}

let _findPackageExtensions:
  | ((name: string, version: string) => unknown)
  | undefined
/**
 * Get the findPackageExtensions function from operations module.
 * Lazy loaded to avoid circular dependency.
 */
/*@__NO_SIDE_EFFECTS__*/
function _getFindPackageExtensions() {
  if (_findPackageExtensions === undefined) {
    // Dynamically import to avoid circular dependency.
    // Use path alias for reliable resolution in both test and production environments.
    const operations: {
      findPackageExtensions: (name: string, version: string) => unknown
    } = require('#packages/operations')
    _findPackageExtensions = operations.findPackageExtensions
  }
  return _findPackageExtensions as (name: string, version: string) => unknown
}

/**
 * Normalize a package.json object with standard npm package normalization.
 */
/*@__NO_SIDE_EFFECTS__*/
export function normalizePackageJson(
  pkgJson: PackageJson,
  options?: NormalizeOptions,
): PackageJson {
  const { preserve } = { __proto__: null, ...options } as NormalizeOptions
  // Add default version if not present.
  if (!ObjectHasOwn(pkgJson, 'version')) {
    pkgJson.version = '0.0.0'
  }
  const preserved = [
    ['_id', undefined],
    ['readme', undefined],
    ...(ObjectHasOwn(pkgJson, 'bugs') ? [] : [['bugs', undefined]]),
    ...(ObjectHasOwn(pkgJson, 'homepage') ? [] : [['homepage', undefined]]),
    ...(ObjectHasOwn(pkgJson, 'name') ? [] : [['name', undefined]]),
    ...(ArrayIsArray(preserve)
      ? preserve.map(k => [
          k,
          ObjectHasOwn(pkgJson, k) ? pkgJson[k] : undefined,
        ])
      : []),
  ]
  const normalizePackageData = getNormalizePackageData()
  normalizePackageData(pkgJson)
  // Apply package extensions if name and version are present.
  if (pkgJson.name && pkgJson.version) {
    const findPackageExtensions = _getFindPackageExtensions()
    const extensions = findPackageExtensions(pkgJson.name, pkgJson.version)
    if (extensions && typeof extensions === 'object') {
      merge(pkgJson, extensions)
    }
  }
  // Revert/remove properties we don't care to have normalized.
  // Properties with undefined values are omitted when saved as JSON.
  for (const { 0: key, 1: value } of preserved) {
    pkgJson[key as keyof typeof pkgJson] = value
  }
  return pkgJson
}

/**
 * Extract escaped scope from a Socket registry package name.
 */
/*@__NO_SIDE_EFFECTS__*/
export function resolveEscapedScope(
  sockRegPkgName: string,
): string | undefined {
  const escapedScopeRegExp = getEscapedScopeRegExp()
  const match = escapedScopeRegExp.exec(sockRegPkgName)?.[0]
  return match || undefined
}

/**
 * Resolve original package name from Socket registry package name.
 */
/*@__NO_SIDE_EFFECTS__*/
export function resolveOriginalPackageName(sockRegPkgName: string): string {
  const SOCKET_REGISTRY_SCOPE = getSocketRegistryScope()
  const name = sockRegPkgName.startsWith(`${SOCKET_REGISTRY_SCOPE}/`)
    ? sockRegPkgName.slice(SOCKET_REGISTRY_SCOPE.length + 1)
    : sockRegPkgName
  const escapedScope = resolveEscapedScope(name)
  return escapedScope
    ? `${unescapeScope(escapedScope)}/${name.slice(escapedScope.length)}`
    : name
}

/**
 * Convert escaped scope to standard npm scope format.
 */
/*@__NO_SIDE_EFFECTS__*/
export function unescapeScope(escapedScope: string): string {
  const REGISTRY_SCOPE_DELIMITER = getRegistryScopeDelimiter()
  return `@${escapedScope.slice(0, -REGISTRY_SCOPE_DELIMITER.length)}`
}
