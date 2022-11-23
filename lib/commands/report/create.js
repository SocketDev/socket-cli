/* eslint-disable no-console */

import { stat } from 'node:fs/promises'
import path from 'node:path'

import meow from 'meow'
import ora from 'ora'
import { ErrorWithCause } from 'pony-cause'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown, logSymbols } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { createDebugLogger } from '../../utils/misc.js'
import { setupSdk } from '../../utils/sdk.js'
import { isErrnoException } from '../../utils/type-helpers.js'
import { fetchReportData, formatReportDataOutput } from './view.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const create = {
  description: 'Create a project report',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' create'

    const input = await setupCommand(name, create.description, argv, importMeta)

    if (input) {
      const {
        cwd,
        debugLog,
        dryRun,
        outputJson,
        outputMarkdown,
        packagePaths,
        view,
      } = input

      const result = input && await createReport(packagePaths, { cwd, debugLog, dryRun })

      if (result && view) {
        const reportId = result.data.id
        const reportResult = input && await fetchReportData(reportId)

        if (reportResult) {
          formatReportDataOutput(reportResult.data, { name, outputJson, outputMarkdown, reportId })
        }
      } else if (result) {
        formatReportCreationOutput(result.data, { outputJson, outputMarkdown })
      }
    }
  }
}

// Internal functions

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {Promise<void|{ cwd: string, debugLog: typeof console.error, dryRun: boolean, outputJson: boolean, outputMarkdown: boolean, packagePaths: string[], view: boolean }>}
 */
async function setupCommand (name, description, argv, importMeta) {
  const cli = meow(`
    Usage
      $ ${name} <paths-to-package-folders-and-files>

    Options
      ${printFlagList({
        '--debug': 'Output debug information',
        '--dry-run': 'Only output what will be done without actually doing it',
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
        '--view': 'Will wait for and return the created report'
      }, 6)}

    Examples
      $ ${name} .
      $ ${name} ../package-lock.json
      $ ${name} /path/to/a/package.json /path/to/another/package.json
      $ ${name} . --view --json
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
      view: {
        type: 'boolean',
        alias: 'v',
        default: false,
      },
    }
  })

  const {
    dryRun,
    json: outputJson,
    markdown: outputMarkdown,
    view,
  } = cli.flags

  if (!cli.input[0]) {
    cli.showHelp()
    return
  }

  const debugLog = createDebugLogger(dryRun || cli.flags.debug)

  const cwd = process.cwd()
  const packagePaths = await resolvePackagePaths(cwd, cli.input)

  return {
    cwd,
    debugLog,
    dryRun,
    outputJson,
    outputMarkdown,
    packagePaths,
    view,
  }
}

/**
 * @param {string[]} packagePaths
 * @param {{ cwd: string, debugLog: typeof console.error, dryRun: boolean }} context
 * @returns {Promise<void|import('@socketsecurity/sdk').SocketSdkReturnType<'createReport'>>}
 */
async function createReport (packagePaths, { cwd, debugLog, dryRun }) {
  debugLog(`${logSymbols.info} Uploading:`, packagePaths.join(`\n${logSymbols.info} Uploading:`))

  if (dryRun) {
    return
  }

  const socketSdk = await setupSdk()
  const spinner = ora(`Creating report with ${packagePaths.length} package files`).start()
  const result = await handleApiCall(socketSdk.createReportFromFilePaths(packagePaths, cwd), spinner, 'creating report')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(result, spinner)
  }

  // Conclude the status of the API call

  spinner.succeed()

  return result
}

/**
 * @param {import('@socketsecurity/sdk').SocketSdkReturnType<'createReport'>["data"]} data
 * @param {{ outputJson: boolean, outputMarkdown: boolean }} context
 * @returns {void}
 */
function formatReportCreationOutput (data, { outputJson, outputMarkdown }) {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
    return
  }

  const format = new ChalkOrMarkdown(!!outputMarkdown)

  console.log('\nNew report: ' + format.hyperlink(data.id, data.url, { fallbackToUrl: true }))
}

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
