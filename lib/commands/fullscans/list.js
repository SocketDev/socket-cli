/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import chalkTable from '../../utils/chalk-table.js'
import { InputError } from '../../utils/errors.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const list = {
  description: 'List full scans',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' list'

    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Listing full scans... \n'
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
    description: 'Sorting option - name or created_at',
  },
  direction: {
    type: 'string',
    shortFlag: 'd',
    default: 'desc',
    description: 'Direction option - desc or asc',
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Results per page',
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number',
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
 * @property {number} perPage
 * @property {number} page
 * @property {string} fromTime
 * @property {string} untilTime
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
    throw new InputError('Please specify an organization slug.')
  }

  const orgSlug = cli.input[0] || ''

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    sort,
    direction,
    perPage,
    page,
    fromTime,
    untilTime
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
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getOrgFullScanList(orgSlug, input), 'Listing full scans')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
  }
  spinner.stop()

  console.log(`\n Listing full scans for: ${orgSlug} \n`)

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'report_url', name: chalk.magenta('Report URL') },
      { field: 'branch', name: chalk.magenta('Branch') },
      { field: 'created_at', name: chalk.magenta('Created at') }
    ]
  }

  const formattedResults = result.data.results.map(d => {
    return {
      id: d.id,
      report_url: chalk.underline(`${d.html_report_url}`),
      created_at: d.created_at ? new Date(d.created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
      branch: d.branch
    }
  })

  const table = chalkTable(options, formattedResults)

  console.log(table, '\n')

  return {
    data: result.data
  }
}
