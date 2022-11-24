/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { getSeverityCount, formatSeverityCount } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
import { objectSome } from '../../utils/misc.js'
import { setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const view = {
  description: 'View a project report',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' view'

    const input = setupCommand(name, view.description, argv, importMeta)
    const result = input && await fetchReportData(input.reportId, input)

    if (result) {
      formatReportDataOutput(result, { name, ...input })
    }
  }
}

// Internal functions

// TODO: Share more of the flag setup inbetween the commands
/**
 * @typedef CommandContext
 * @property {boolean} includeAllIssues
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} reportId
 * @property {boolean} strict
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void|CommandContext}
 */
function setupCommand (name, description, argv, importMeta) {
  const cli = meow(`
    Usage
      $ ${name} <report-identifier>

    Options
      ${printFlagList({
        '--all': 'Include all issues',
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
        '--strict': 'Exits with an error code if any matching issues are found',
      }, 6)}

    Examples
      $ ${name} QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
  `, {
    argv,
    description,
    importMeta,
    flags: {
      all: {
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
    }
  })

  // Extract the input

  const {
    all: includeAllIssues,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
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
    includeAllIssues,
    outputJson,
    outputMarkdown,
    reportId,
    strict,
  }
}

/**
 * @typedef ReportData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getReport'>["data"]} data
 * @property {Record<import('../../utils/format-issues').SocketIssue['severity'], number>} severityCount
 */

/**
 * @param {string} reportId
 * @param {Pick<CommandContext, 'includeAllIssues' | 'strict'>} context
 * @returns {Promise<void|ReportData>}
 */
export async function fetchReportData (reportId, { includeAllIssues, strict }) {
  // Do the API call

  const socketSdk = await setupSdk()
  const spinner = ora(`Fetching report with ID ${reportId}`).start()
  const result = await handleApiCall(socketSdk.getReport(reportId), spinner, 'fetching report')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(result, spinner)
  }

  // Conclude the status of the API call

  const severityCount = getSeverityCount(result.data.issues, includeAllIssues ? undefined : 'high')

  if (objectSome(severityCount)) {
    const issueSummary = formatSeverityCount(severityCount)
    spinner[strict ? 'fail' : 'succeed'](`Report has these issues: ${issueSummary}`)
  } else {
    spinner.succeed('Report has no issues')
  }

  return {
    data: result.data,
    severityCount,
  }
}

/**
 * @param {ReportData} reportData
 * @param {{ name: string } & CommandContext} context
 * @returns {void}
 */
export function formatReportDataOutput ({ data, severityCount }, { name, outputJson, outputMarkdown, reportId, strict }) {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    const format = new ChalkOrMarkdown(!!outputMarkdown)
    const url = `https://socket.dev/npm/reports/${encodeURIComponent(reportId)}`

    console.log('\nDetailed info on socket.dev: ' + format.hyperlink(reportId, url, { fallbackToUrl: true }))
    if (!outputMarkdown) {
      console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
    }
  }

  if (strict && objectSome(severityCount)) {
    process.exit(1)
  }
}
