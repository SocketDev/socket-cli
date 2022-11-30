import { stat } from 'node:fs/promises'
import path from 'node:path'

import { ErrorWithCause } from 'pony-cause'

import { InputError } from './errors.js'
import { isErrnoException } from './type-helpers.js'

// TODO: Add globbing support with support for ignoring, as a "./**/package.json" in a project also traverses eg. node_modules
/**
 * Takes paths to folders and/or package.json / package-lock.json files and resolves to package.json + package-lock.json pairs (where feasible)
 *
 * @param {string} cwd
 * @param {string[]} inputPaths
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
export async function resolvePackagePaths (cwd, inputPaths) {
  const packagePathLookups = inputPaths.map(async (filePath) => {
    const packagePath = await resolvePackagePath(cwd, filePath)
    return findComplementaryPackageFile(packagePath)
  })

  const packagePaths = await Promise.all(packagePathLookups)

  const uniquePackagePaths = new Set(packagePaths.flat())

  return [...uniquePackagePaths]
}

/**
 * Resolves a package.json / package-lock.json path from a relative folder / file path
 *
 * @param {string} cwd
 * @param {string} inputPath
 * @returns {Promise<string>}
 * @throws {InputError}
 */
async function resolvePackagePath (cwd, inputPath) {
  const filePath = path.resolve(cwd, inputPath)
  /** @type {string|undefined} */
  let filePathAppended

  try {
    const fileStat = await stat(filePath)

    if (fileStat.isDirectory()) {
      filePathAppended = path.resolve(filePath, 'package.json')
    }
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      throw new InputError(`Expected '${inputPath}' to point to an existing file or directory`)
    }
    throw new ErrorWithCause('Failed to resolve path to package.json', { cause: err })
  }

  if (filePathAppended) {
    /** @type {import('node:fs').Stats} */
    let filePathAppendedStat

    try {
      filePathAppendedStat = await stat(filePathAppended)
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        throw new InputError(`Expected directory '${inputPath}' to contain a package.json file`)
      }
      throw new ErrorWithCause('Failed to resolve package.json in directory', { cause: err })
    }

    if (!filePathAppendedStat.isFile()) {
      throw new InputError(`Expected '${filePathAppended}' to be a file`)
    }

    return filePathAppended
  }

  return filePath
}

/**
 * Finds any complementary file to a package.json or package-lock.json
 *
 * @param {string} packagePath
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
async function findComplementaryPackageFile (packagePath) {
  const basename = path.basename(packagePath)
  const dirname = path.dirname(packagePath)

  if (basename === 'package-lock.json') {
    // We need the package file as well
    return [
      packagePath,
      path.resolve(dirname, 'package.json')
    ]
  }

  if (basename === 'package.json') {
    const lockfilePath = path.resolve(dirname, 'package-lock.json')
    try {
      const lockfileStat = await stat(lockfilePath)
      if (lockfileStat.isFile()) {
        return [packagePath, lockfilePath]
      }
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return [packagePath]
      }
      throw new ErrorWithCause(`Unexpected error when finding a lockfile for '${packagePath}'`, { cause: err })
    }

    throw new InputError(`Encountered a non-file at lockfile path '${lockfilePath}'`)
  }

  throw new InputError(`Expected '${packagePath}' to point to a package.json or package-lock.json or to a folder containing a package.json`)
}
