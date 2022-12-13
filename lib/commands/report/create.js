/* eslint-disable no-console */

import path from 'node:path'

import { betterAjvErrors } from '@apideck/better-ajv-errors'
import { readSocketConfig, SocketValidationError } from '@socketsecurity/config'
import meow from 'meow'
import ora from 'ora'
import { ErrorWithCause } from 'pony-cause'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown, logSymbols } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { createDebugLogger } from '../../utils/misc.js'
import { getPackageFiles } from '../../utils/path-resolve.js'
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

    Uploads the specified "package.json" and lock files and, if any folder is
    specified, the ones found in there. Also includes the complementary
    "package.json" and lock file to any specified. Currently "package-lock.json"
    and "yarn.lock" are supported.

    Supports globbing such as "**/package.json".

    Ignores any file specified in your project's ".gitignore", your project's
    "socket.yml" file's "projectIgnorePaths" and also has a sensible set of
    default ignores from the "ignore-by-default" module.

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
      $ ${name} '**/package.json'
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

  // TODO: Allow setting a custom cwd and/or configFile path?
  const cwd = process.cwd()
  const absoluteConfigPath = path.join(cwd, 'socket.yml')

  const config = await readSocketConfig(absoluteConfigPath)
    .catch(/** @param {unknown} cause */ cause => {
      if (cause && typeof cause === 'object' && cause instanceof SocketValidationError) {
        // Inspired by workbox-build: https://github.com/GoogleChrome/workbox/blob/95f97a207fd51efb3f8a653f6e3e58224183a778/packages/workbox-build/src/lib/validate-options.ts#L68-L71
        const betterErrors = betterAjvErrors({
          basePath: 'config',
          data: cause.data,
          errors: cause.validationErrors,
          // @ts-ignore
          schema: cause.schema,
        })
        throw new InputError(
          'The socket.yml config is not valid',
          betterErrors.map((err) => `[${err.path}] ${err.message}.${err.suggestion ? err.suggestion : ''}`).join('\n')
        )
      } else {
        throw new ErrorWithCause('Failed to read socket.yml config', { cause })
      }
    })

  const packagePaths = await getPackageFiles(cwd, cli.input, config, debugLog)

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
  debugLog('Uploading:', packagePaths.join(`\n${logSymbols.info} Uploading: `))

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
