/* eslint-disable no-console */

import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const view = {
  description: 'View repositories in an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' view'

    const input = setupCommand(name, view.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Fetching repository... \n'
      const spinner = ora(spinnerText).start()
      await viewRepository(input.orgSlug, input.repositoryName, spinner)
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} repositoryName
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
    ...outputFlags
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
    markdown: outputMarkdown
  } = cli.flags

  if (!cli.input[0]) {
    console.error(`${chalk.bgRed('Input error')}: Please provide an organization slug and repository name \n`)
    cli.showHelp()
    return
  }

  const [orgSlug = '', repositoryName = ''] = cli.input

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    repositoryName
  }
}

/**
 * @typedef RepositoryData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgRepo'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {string} repoName
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|RepositoryData>}
 */
async function viewRepository (orgSlug, repoName, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getOrgRepo(orgSlug, repoName), 'fetching repository')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getOrgRepo', result, spinner)
  }

  spinner.stop()

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'name', name: chalk.magenta('Name') },
      { field: 'visibility', name: chalk.magenta('Visibility') },
      { field: 'default_branch', name: chalk.magenta('Default branch') },
      { field: 'homepage', name: chalk.magenta('Homepage') },
      { field: 'archived', name: chalk.magenta('Archived') },
      { field: 'created_at', name: chalk.magenta('Created at') }
    ]
  }

  const table = chalkTable(options, [result.data])

  console.log(table, '\n')

  return {
    // @ts-ignore
    data: result.data
  }
}
