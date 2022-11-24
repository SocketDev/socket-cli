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
        includeAllIssues,
        outputJson,
        outputMarkdown,
        packagePaths,
        strict,
        view,
      } = input

      const result = input && await createReport(packagePaths, { cwd, debugLog, dryRun })

      if (result && view) {
        const reportId = result.data.id
        const reportData = input && await fetchReportData(reportId, { includeAllIssues, strict })

        if (reportData) {
          formatReportDataOutput(reportData, { includeAllIssues, name, outputJson, outputMarkdown, reportId, strict })
        }
      } else if (result) {
        formatReportCreationOutput(result.data, { outputJson, outputMarkdown })
      }
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {string} cwd
 * @property {typeof console.error} debugLog
 * @property {boolean} dryRun
 * @property {boolean} includeAllIssues
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string[]} packagePaths
 * @property {boolean} strict
 * @property {boolean} view
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {Promise<void|CommandContext>}
 */
async function setupCommand (name, description, argv, importMeta) {
  const cli = meow(`
    Usage
      $ ${name} <paths-to-package-folders-and-files>

    Options
      ${printFlagList({
        '--all': 'Include all issues',
        '--debug': 'Output debug information',
        '--dry-run': 'Only output what will be done without actually doing it',
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
        '--strict': 'Exits with an error code if any matching issues are found',
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
      all: {
        type: 'boolean',
        default: false,
      },
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
      strict: {
        type: 'boolean',
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
    all: includeAllIssues,
    dryRun,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
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
    includeAllIssues,
    outputJson,
    outputMarkdown,
    packagePaths,
    strict,
    view,
  }
}

/**
 * @param {string[]} packagePaths
 * @param {Pick<CommandContext, 'cwd' | 'debugLog' | 'dryRun'>} context
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
 * @param {Pick<CommandContext, 'outputJson' | 'outputMarkdown'>} context
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
