/* eslint-disable no-console */

import { stat } from 'node:fs/promises'
import path from 'node:path'

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'
import { ErrorWithCause } from 'pony-cause'

import { ChalkOrMarkdown, logSymbols } from '../../utils/chalk-markdown.js'
import { AuthError, InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { createDebugLogger } from '../../utils/misc.js'
import { setupSdk } from '../../utils/sdk.js'
import { isErrnoException } from '../../utils/type-helpers.js'

const description = 'Create a project report'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommandRun} */
const run = async (argv, importMeta, { parentName }) => {
  const name = parentName + ' create'

  const cli = meow(`
    Usage
      $ ${name} <paths-to-package-folders-and-files>

    Options
      ${printFlagList({
        '--debug': 'Output debug information',
        '--dry-run': 'Only output what will be done without actually doing it',
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
      }, 6)}

    Examples
      $ ${name} .
      $ ${name} ../package-lock.json
      $ ${name} /path/to/a/package.json /path/to/another/package.json
  `, {
    argv,
    description,
    importMeta,
    flags: {
      debug: {
        type: 'boolean',
        alias: 'd',
        default: false,
      },
      dryRun: {
        type: 'boolean',
        default: false,
      },
      json: {
        type: 'boolean',
        alias: 'j',
        default: false,
      },
      markdown: {
        type: 'boolean',
        alias: 'm',
        default: false,
      },
    }
  })

  const {
    dryRun,
    json: outputJson,
    markdown: outputMarkdown,
  } = cli.flags

  if (!cli.input[0]) {
    cli.showHelp()
    return
  }

  const debugLog = createDebugLogger(dryRun || cli.flags.debug)

  const cwd = process.cwd()
  const packagePaths = await resolvePackagePaths(cwd, cli.input)

  debugLog(`${logSymbols.info} Uploading:`, packagePaths.join(`\n${logSymbols.info} Uploading:`))

  if (dryRun) {
    return
  }

  const socketSdk = await setupSdk()

  const spinner = ora(`Creating report with ${packagePaths.length} package files`).start()

  /** @type {Awaited<ReturnType<typeof socketSdk.createReportFromFilePaths>>} */
  let result

  try {
    result = await socketSdk.createReportFromFilePaths(packagePaths, cwd)
  } catch (cause) {
    spinner.fail()
    throw new ErrorWithCause('Failed creating report', { cause })
  }

  if (result.success === false) {
    if (result.status === 401 || result.status === 403) {
      spinner.stop()
      throw new AuthError(result.error.message)
    }
    spinner.fail(chalk.white.bgRed('API returned an error:') + ' ' + result.error.message)
    process.exit(1)
  }

  spinner.succeed()

  if (outputJson) {
    console.log(JSON.stringify(result.data, undefined, 2))
    return
  }

  const format = new ChalkOrMarkdown(!!outputMarkdown)

  console.log('\nNew report: ' + format.hyperlink(result.data.id, result.data.url, { fallbackToUrl: true }))
}

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const create = { description, run }

// TODO: Add globbing support with support for ignoring, as a "./**/package.json" in a project also traverses eg. node_modules
/**
 * Takes paths to folders and/or package.json / package-lock.json files and resolves to package.json + package-lock.json pairs (where feasible)
 *
 * @param {string} cwd
 * @param {string[]} inputPaths
 * @returns {Promise<string[]>}
 * @throws {InputError}
 */
async function resolvePackagePaths (cwd, inputPaths) {
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
