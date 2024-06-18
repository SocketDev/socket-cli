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

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const list = {
  description: 'List repositories in an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' list'

    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Listing repositories... \n'
      const spinner = ora(spinnerText).start()
      await listOrgRepos(input.orgSlug, input, spinner)
    }
  }
}

const listRepoFlags = prepareFlags({
  sort: {
    type: 'string',
    shortFlag: 's',
    default: 'created_at',
    description: 'Sorting option',
  },
  direction: {
    type: 'string',
    default: 'desc',
    description: 'Direction option',
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Number of results per page'
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number'
  },
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
    ...listRepoFlags
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
    perPage,
    sort,
    direction,
    page
  } = cli.flags

  if (!cli.input[0]) {
    console.error(`${chalk.bgRed('Input error')}: Please provide an organization slug \n`)
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
    page,
    per_page: perPage
  }
}

/**
 * @typedef RepositoryData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgRepoList'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|RepositoryData>}
 */
async function listOrgRepos (orgSlug, input, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getOrgRepoList(orgSlug, input), 'looking up package')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getOrgRepoList', result, spinner)
  }

  spinner.stop()

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'name', name: chalk.magenta('Name') },
      { field: 'visibility', name: chalk.magenta('Visibility') },
      { field: 'default_branch', name: chalk.magenta('Default branch') },
      { field: 'archived', name: chalk.magenta('Archived') }
    ]
  }

  // @ts-ignore
  const formattedResults = result.data.results.map(d => {
    return {
      ...d
    }
  })

  const table = chalkTable(options, formattedResults)

  console.log(table, '\n')

  return {
    data: result.data
  }
}
