import { stat } from 'node:fs/promises'
import path from 'node:path'

import { globby } from 'globby'
import ignore from 'ignore'
// @ts-ignore This package provides no types
import { directories } from 'ignore-by-default'
import micromatch from 'micromatch'
import { ErrorWithCause } from 'pony-cause'

import { InputError } from './errors.js'
import { setupSdk } from './sdk.js'
import { isErrnoException } from './type-helpers.js'

/**
 * There are a lot of possible folders that we should not be looking in and "ignore-by-default" helps us with defining those
 *
 * @type {readonly string[]}
 */
const ignoreByDefault = directories()

/** @type { string[]} */
const GLOB_IGNORE = [
  ...ignoreByDefault.map(item => '**/' + item)
]

/** @type {import('globby').Options} */
const BASE_GLOBBY_OPTS = {
  absolute: true,
  expandDirectories: false,
  gitignore: true,
  ignore: GLOB_IGNORE,
  markDirectories: true,
  unique: true,
}

/**
 * Resolves package.json and lockfiles from (globbed) input paths, applying relevant ignores
 *
 * @param {string} cwd The working directory to use when resolving paths
 * @param {string[]} inputPaths A list of paths to folders, package.json files and/or recognized lockfiles. Supports globs.
 * @param {import('@socketsecurity/config').SocketYml|undefined} config
 * @param {typeof console.error} debugLog
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
export async function getPackageFiles (cwd, inputPaths, config, debugLog) {
  debugLog(`Globbed resolving ${inputPaths.length} paths:`, inputPaths)

  // TODO: Does not support `~/` paths
  const entries = await globby(inputPaths, {
    ...BASE_GLOBBY_OPTS,
    cwd,
    onlyFiles: false
  })

  debugLog(`Globbed resolved ${inputPaths.length} paths to ${entries.length} paths:`, entries)

  const packageFiles = await mapGlobResultToFiles(entries)

  debugLog(`Mapped ${entries.length} entries to ${packageFiles.length} files:`, packageFiles)

  const includedPackageFiles = config?.projectIgnorePaths?.length
    ? ignore()
      .add(config.projectIgnorePaths)
      .filter(packageFiles.map(item => path.relative(cwd, item)))
      .map(item => path.resolve(cwd, item))
    : packageFiles

  return includedPackageFiles
}

/**
 * Takes paths to folders, package.json and/or recognized lock files and resolves them to package.json + lockfile pairs (where possible)
 *
 * @param {string[]} entries
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
export async function mapGlobResultToFiles (entries) {
  // TODO: setupSdk(getDefaultKey() || FREE_API_KEY) after #46 merged
  const sdk = await setupSdk()
  const supportedFiles = await sdk.getReportSupportedFiles()
  const packageFiles = await Promise.all(
    entries.map(entry => mapGlobEntryToFiles(entry, supportedFiles))
  )

  const uniquePackageFiles = [...new Set(packageFiles.flat())]

  return uniquePackageFiles
}

/**
 * Takes a single path to a folder, package.json or a recognized lock file and resolves to a package.json + lockfile pair (where possible)
 *
 * @param {string} entry
 * @param {import('@socketsecurity/sdk').SocketSdkReturnType<'getReportSupportedFiles'>['data']} supportedFiles
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
export async function mapGlobEntryToFiles (entry, supportedFiles) {
  /** @type {string|undefined} */
  let pkgJSFile
  /** @type {string[]} */
  let jsLockFiles = []
  /** @type {string[]} */
  let pyFiles = []

  const jsSupported = supportedFiles['npm'] || {}
  const jsLockFilePatterns = Object.keys(jsSupported)
    .filter(key => key !== 'packagejson')
    .map(key => /** @type {{ pattern: string }} */ (jsSupported[key]).pattern)

  const pyFilePatterns = Object.values(supportedFiles['pypi'] || {}).map(p => p.pattern)
  if (entry.endsWith('/')) {
    // If the match is a folder and that folder contains a package.json file, then include it
    const filePath = path.resolve(entry, 'package.json')
    if (await fileExists(filePath)) pkgJSFile = filePath
    pyFiles = await globby(pyFilePatterns, {
      ...BASE_GLOBBY_OPTS,
      cwd: entry
    })
  } else if (path.basename(entry) === 'package.json') {
    // If the match is a package.json file, then include it
    pkgJSFile = entry
  } else if (micromatch.isMatch(entry, jsLockFilePatterns)) {
    jsLockFiles = [entry]
    pkgJSFile = path.resolve(path.dirname(entry), 'package.json')
    if (!(await fileExists(pkgJSFile))) return []
  } else if (micromatch.isMatch(entry, pyFilePatterns)) {
    pyFiles = [entry]
  }

  // If we will include a package.json file but don't already have a corresponding lockfile, then look for one
  if (!jsLockFiles.length && pkgJSFile) {
    const pkgDir = path.dirname(pkgJSFile)

    jsLockFiles = await globby(jsLockFilePatterns, {
      ...BASE_GLOBBY_OPTS,
      cwd: pkgDir
    })
  }

  return [...jsLockFiles, ...pyFiles].concat(pkgJSFile ? [pkgJSFile] : [])
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function fileExists (filePath) {
  /** @type {import('node:fs').Stats} */
  let pathStat

  try {
    pathStat = await stat(filePath)
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return false
    }
    throw new ErrorWithCause('Error while checking if file exists', { cause: err })
  }

  if (!pathStat.isFile()) {
    throw new InputError(`Expected '${filePath}' to be a file`)
  }

  return true
}
