import { stat } from 'node:fs/promises'
import path from 'node:path'

import { globby } from 'globby'
import ignore from 'ignore'
// @ts-ignore This package provides no types
import { directories } from 'ignore-by-default'
import { ErrorWithCause } from 'pony-cause'

import { InputError } from './errors.js'
import { isErrnoException } from './type-helpers.js'

/** @type {readonly string[]} */
const SUPPORTED_LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
]

/**
 * There are a lot of possible folders that we should not be looking in and "ignore-by-default" helps us with defining those
 *
 * @type {readonly string[]}
 */
const ignoreByDefault = directories()

/** @type {readonly string[]} */
const GLOB_IGNORE = [
  ...ignoreByDefault.map(item => '**/' + item)
]

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
  const entries = await globby(inputPaths, {
    absolute: true,
    cwd,
    expandDirectories: false,
    gitignore: true,
    ignore: [...GLOB_IGNORE],
    markDirectories: true,
    onlyFiles: false,
    unique: true,
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
  const packageFiles = await Promise.all(entries.map(mapGlobEntryToFiles))

  const uniquePackageFiles = [...new Set(packageFiles.flat())]

  return uniquePackageFiles
}

/**
 * Takes a single path to a folder, package.json or a recognized lock file and resolves to a package.json + lockfile pair (where possible)
 *
 * @param {string} entry
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
export async function mapGlobEntryToFiles (entry) {
  /** @type {string|undefined} */
  let pkgFile
  /** @type {string|undefined} */
  let lockFile

  if (entry.endsWith('/')) {
    // If the match is a folder and that folder contains a package.json file, then include it
    const filePath = path.resolve(entry, 'package.json')
    pkgFile = await fileExists(filePath) ? filePath : undefined
  } else if (path.basename(entry) === 'package.json') {
    // If the match is a package.json file, then include it
    pkgFile = entry
  } else if (SUPPORTED_LOCKFILES.includes(path.basename(entry))) {
    // If the match is a lock file, include both it and the corresponding package.json file
    lockFile = entry
    pkgFile = path.resolve(path.dirname(entry), 'package.json')
  }

  // If we will include a package.json file but don't already have a corresponding lockfile, then look for one
  if (!lockFile && pkgFile) {
    const pkgDir = path.dirname(pkgFile)

    for (const name of SUPPORTED_LOCKFILES) {
      const lockFileAlternative = path.resolve(pkgDir, name)
      if (await fileExists(lockFileAlternative)) {
        lockFile = lockFileAlternative
        break
      }
    }
  }

  if (pkgFile && lockFile) {
    return [pkgFile, lockFile]
  }

  return pkgFile ? [pkgFile] : []
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
