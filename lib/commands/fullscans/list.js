/* eslint-disable no-console */

import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const list = {
  description: 'List scans for an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' list'

    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Listing scans... \n'
      const spinner = ora(spinnerText).start()
      await listOrgFullScan(input.orgSlug, input, spinner)
    }
  }
}

const listFullScanFlags = prepareFlags({
  sort: {
    type: 'string',
    shortFlag: 's',
    default: 'created_at',
    description: 'Sorting option (`name` or `created_at`) - default is `created_at`',
  },
  direction: {
    type: 'string',
    shortFlag: 'd',
    default: 'desc',
    description: 'Direction option (`desc` or `asc`) - Default is `desc`',
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Results per page - Default is 30',
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number - Default is 1',
  },
  fromTime: {
    type: 'string',
    shortFlag: 'f',
    default: '',
    description: 'From time - as a unix timestamp',
  },
  untilTime: {
    type: 'string',
    shortFlag: 'u',
    default: '',
    description: 'Until time - as a unix timestamp',
  }
})

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} sort
 * @property {string} direction
 * @property {number} per_page
 * @property {number} page
 * @property {string} from_time
 * @property {string} until_time
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
    ...listFullScanFlags
  }

  const cli = meow(`
    Usage
      $ ${name} <org slug>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    json: outputJson,
    markdown: outputMarkdown,
    sort,
    direction,
    perPage,
    page,
    fromTime,
    untilTime
  } = cli.flags

  if (!cli.input[0]) {
    console.error(`${chalk.bgRed('Input error')}: Please specify an organization slug.\n`)
    cli.showHelp()
    return
  }

  const [orgSlug = ''] = cli.input

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    sort,
    direction,
    per_page: perPage,
    page,
    from_time: fromTime,
    until_time: untilTime
  }
}

/**
 * @typedef FullScansData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgFullScanList'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|FullScansData>}
 */
async function listOrgFullScan (orgSlug, input, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  console.log(input)
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getOrgFullScanList(orgSlug, input), 'Listing scans')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
  }
  spinner.stop()

  console.log(`\n Listing scans for: ${orgSlug} \n`)

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'report_url', name: chalk.magenta('Scan URL') },
      { field: 'branch', name: chalk.magenta('Branch') },
      { field: 'created_at', name: chalk.magenta('Created at') }
    ]
  }

  const formattedResults = result.data.results.map(d => {
    return {
      id: d.id,
      report_url: chalk.underline(`${d.html_report_url}`),
      created_at: d.created_at ? new Date(d.created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '',
      branch: d.branch
    }
  })

  const table = chalkTable(options, formattedResults)

  console.log(table, '\n')

  return {
    data: result.data
  }
}
