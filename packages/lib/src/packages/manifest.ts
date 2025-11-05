/**
 * @fileoverview Package manifest and packument fetching utilities.
 */

import {
  getPackageDefaultNodeRange,
  getPackageDefaultSocketCategories,
  getPackumentCache,
} from '#constants/packages'
import { getAbortSignal } from '#constants/process'
import { SOCKET_GITHUB_ORG, SOCKET_REGISTRY_REPO_NAME } from '#constants/socket'

const abortSignal = getAbortSignal()
const packageDefaultNodeRange = getPackageDefaultNodeRange()
const PACKAGE_DEFAULT_SOCKET_CATEGORIES = getPackageDefaultSocketCategories()
const packumentCache = getPackumentCache()

import { isArray } from '../arrays'
import { isObjectObject, objectEntries } from '../objects'
import type { PackageJson, PacoteOptions } from '../packages'
import { resolvePackageJsonEntryExports } from './exports'
import { isRegistryFetcherType } from './validation'

const pkgScopePrefixRegExp = /^@socketregistry\//

let _npmPackageArg: typeof import('npm-package-arg') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getNpmPackageArg() {
  if (_npmPackageArg === undefined) {
    _npmPackageArg = /*@__PURE__*/ require('npm-package-arg')
  }
  return _npmPackageArg as typeof import('npm-package-arg')
}

let _pacote: typeof import('pacote') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getPacote() {
  if (_pacote === undefined) {
    _pacote = /*@__PURE__*/ require('pacote')
  }
  return _pacote as typeof import('pacote')
}

let _semver: typeof import('semver') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getSemver() {
  if (_semver === undefined) {
    // The 'semver' package is browser safe.
    _semver = /*@__PURE__*/ require('semver')
  }
  return _semver as typeof import('semver')
}

/**
 * Create a package.json object for a Socket registry package.
 */
/*@__NO_SIDE_EFFECTS__*/
export function createPackageJson(
  sockRegPkgName: string,
  directory: string,
  options?: PackageJson | undefined,
): PackageJson {
  const {
    dependencies,
    description,
    engines,
    exports: entryExportsRaw,
    files,
    keywords,
    main,
    overrides,
    resolutions,
    sideEffects,
    socket,
    type,
    version,
  } = { __proto__: null, ...options } as PackageJson
  const name = `@socketregistry/${sockRegPkgName.replace(pkgScopePrefixRegExp, '')}`
  const entryExports = resolvePackageJsonEntryExports(entryExportsRaw)
  const githubUrl = `https://github.com/${SOCKET_GITHUB_ORG}/${SOCKET_REGISTRY_REPO_NAME}`
  return {
    __proto__: null,
    name,
    version,
    license: 'MIT',
    description,
    keywords,
    homepage: `${githubUrl}/tree/main/${directory}`,
    repository: {
      type: 'git',
      url: `git+${githubUrl}.git`,
      directory,
    },
    ...(type ? { type } : {}),
    ...(isObjectObject(entryExports) ? { exports: { ...entryExports } } : {}),
    ...(entryExports ? {} : { main: `${main ?? './index.js'}` }),
    sideEffects: sideEffects !== undefined && !!sideEffects,
    ...(isObjectObject(dependencies)
      ? { dependencies: { ...dependencies } }
      : {}),
    ...(isObjectObject(overrides) ? { overrides: { ...overrides } } : {}),
    ...(isObjectObject(resolutions) ? { resolutions: { ...resolutions } } : {}),
    ...(isObjectObject(engines)
      ? {
          engines: Object.fromEntries(
            objectEntries(engines).map((pair: [PropertyKey, unknown]) => {
              const strKey = String(pair[0])
              const result: [string, unknown] = [strKey, pair[1]]
              if (strKey === 'node') {
                const semver = getSemver()
                const { 1: range } = result
                if (
                  typeof range === 'string' &&
                  range &&
                  packageDefaultNodeRange
                ) {
                  // Roughly check Node range as semver.coerce will strip leading
                  // v's, carets (^), comparators (<,<=,>,>=,=), and tildes (~).
                  const coercedRange = semver.coerce(range)
                  if (
                    !semver.satisfies(
                      coercedRange?.version ?? '0.0.0',
                      packageDefaultNodeRange,
                    )
                  ) {
                    result[1] = packageDefaultNodeRange
                  }
                }
              }
              return result
            }),
          ),
        }
      : { engines: { node: packageDefaultNodeRange } }),
    files: isArray(files) ? files.slice() : ['*.d.ts', '*.js'],
    ...(isObjectObject(socket)
      ? { socket: { ...socket } }
      : {
          socket: {
            // Valid categories are: cleanup, levelup, speedup, tuneup
            categories: PACKAGE_DEFAULT_SOCKET_CATEGORIES,
          },
        }),
  } as PackageJson
}

/**
 * Fetch the manifest for a package.
 */
/*@__NO_SIDE_EFFECTS__*/
export async function fetchPackageManifest(
  pkgNameOrId: string,
  options?: PacoteOptions,
): Promise<unknown> {
  const pacoteOptions = {
    __proto__: null,
    signal: abortSignal,
    ...options,
    packumentCache,
    preferOffline: true,
  } as PacoteOptions & { where?: string }
  const { signal } = pacoteOptions
  if (signal?.aborted) {
    return undefined
  }
  const pacote = getPacote()
  let result: unknown
  try {
    result = await pacote.manifest(pkgNameOrId, pacoteOptions)
  } catch {}
  if (signal?.aborted) {
    return undefined
  }
  if (result) {
    const npmPackageArg = getNpmPackageArg()
    const spec = npmPackageArg(pkgNameOrId, pacoteOptions.where)
    if (isRegistryFetcherType(spec.type)) {
      return result
    }
  }
  // Convert a manifest not fetched by RegistryFetcher to one that is.
  if (result) {
    const typedResult = result as { name: string; version: string }
    return await fetchPackageManifest(
      `${typedResult.name}@${typedResult.version}`,
      pacoteOptions,
    )
  }
  return null
}

/**
 * Fetch the packument (package document) for a package.
 */
/*@__NO_SIDE_EFFECTS__*/
export async function fetchPackagePackument(
  pkgNameOrId: string,
  options?: PacoteOptions,
): Promise<unknown> {
  const pacote = getPacote()
  try {
    return await pacote.packument(pkgNameOrId, {
      __proto__: null,
      signal: abortSignal,
      ...options,
      packumentCache,
      preferOffline: true,
    })
  } catch {}
  return undefined
}
