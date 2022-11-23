/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { getSeveritySummary } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
import { setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const view = {
  description: 'View a project report',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' view'

    const input = setupCommand(name, view.description, argv, importMeta)
    const result = input && await fetchReportData(input.reportId)

    if (result) {
      formatReportDataOutput(result.data, { name, ...input })
    }
  }
}

// Internal functions

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void|{ outputJson: boolean, outputMarkdown: boolean, reportId: string }}
 */
function setupCommand (name, description, argv, importMeta) {
  const cli = meow(`
    Usage
      $ ${name} <report-identifier>

    Options
      ${printFlagList({
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
      }, 6)}

    Examples
      $ ${name} QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
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

  // Extract the input

  const {
    json: outputJson,
    markdown: outputMarkdown,
  } = cli.flags

  const [reportId, ...extraInput] = cli.input

  if (!reportId) {
    cli.showHelp()
    return
  }

  // Validate the input

  if (extraInput.length) {
    throw new InputError(`Can only handle a single report ID at a time, but got ${cli.input.length} report ID:s: ${cli.input.join(', ')}`)
  }

  return {
    outputJson,
    outputMarkdown,
    reportId,
  }
}

/**
 * @param {string} reportId
 * @returns {Promise<void|import('@socketsecurity/sdk').SocketSdkReturnType<'getReport'>>}
 */
export async function fetchReportData (reportId) {
  // Do the API call

  const socketSdk = await setupSdk()
  const spinner = ora(`Fetching report with ID ${reportId}`).start()
  const result = await handleApiCall(socketSdk.getReport(reportId), spinner, 'fetching report')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(result, spinner)
  }

  // Conclude the status of the API call

  const issueSummary = getSeveritySummary(result.data.issues)
  spinner.succeed(`Report contains ${issueSummary || 'no'} issues`)

  return result
}

/**
 * @param {import('@socketsecurity/sdk').SocketSdkReturnType<'getReport'>["data"]} data
 * @param {{ name: string, outputJson: boolean, outputMarkdown: boolean, reportId: string }} context
 * @returns {void}
 */
export function formatReportDataOutput (data, { name, outputJson, outputMarkdown, reportId }) {
  // If JSON, output and return...

  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
    return
  }

  // ...else do the CLI / Markdown output dance

  const format = new ChalkOrMarkdown(!!outputMarkdown)
  const url = `https://socket.dev/npm/reports/${encodeURIComponent(reportId)}`

  console.log('\nDetailed info on socket.dev: ' + format.hyperlink(reportId, url, { fallbackToUrl: true }))
  if (!outputMarkdown) {
    console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
  }
}
