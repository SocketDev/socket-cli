/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { getSeverityCount, formatSeverityCount } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
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
  const flags = {
    ...outputFlags,
    ...validationFlags,
  }

  const cli = meow(`
    Usage
      $ ${name} <report-identifier>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
  `, {
    argv,
    description,
    importMeta,
    flags,
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
 * @typedef {import('@socketsecurity/sdk').SocketSdkReturnType<'getReport'>["data"]} ReportData
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
    return handleUnsuccessfulApiResponse('getReport', result, spinner)
  }

  // Conclude the status of the API call

  if (strict) {
    if (result.data.healthy) {
      spinner.succeed('Report result is healthy and great!')
    } else {
      spinner.fail('Report result deemed unhealthy for project')
    }
  } else if (result.data.healthy === false) {
    const severityCount = getSeverityCount(result.data.issues, includeAllIssues ? undefined : 'high')
    const issueSummary = formatSeverityCount(severityCount)
    spinner.succeed(`Report has these issues: ${issueSummary}`)
  } else {
    spinner.succeed('Report has no issues')
  }

  return result.data
}

/**
 * @param {ReportData} data
 * @param {{ name: string } & CommandContext} context
 * @returns {void}
 */
export function formatReportDataOutput (data, { name, outputJson, outputMarkdown, reportId, strict }) {
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

  if (strict && data.healthy === false) {
    process.exit(1)
  }
}
