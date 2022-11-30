/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown, logSymbols } from '../../utils/chalk-markdown.js'
import { printFlagList } from '../../utils/formatting.js'
import { createDebugLogger } from '../../utils/misc.js'
import { resolvePackagePaths } from '../../utils/path-resolve.js'
import { setupSdk } from '../../utils/sdk.js'
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
