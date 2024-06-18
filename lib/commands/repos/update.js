/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const update = {
  description: 'Update a repository in an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' update'

    const input = setupCommand(name, update.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Updating repository... \n'
      const spinner = ora(spinnerText).start()
      await updateRepository(input.orgSlug, input, spinner)
    }
  }
}

const repositoryUpdateFlags = prepareFlags({
  repoName: {
    type: 'string',
    shortFlag: 'n',
    default: '',
    description: 'Repository name',
  },
  repoDescription: {
    type: 'string',
    shortFlag: 'd',
    default: '',
    description: 'Repository description',
  },
  homepage: {
    type: 'string',
    shortFlag: 'h',
    default: '',
    description: 'Repository url',
  },
  defaultBranch: {
    type: 'string',
    shortFlag: 'b',
    default: 'main',
    description: 'Repository default branch',
  },
  visibility: {
    type: 'string',
    shortFlag: 'v',
    default: 'private',
    description: 'Repository visibility (Default Private)',
  }
})

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} name
 * @property {string} description
 * @property {string} homepage
 * @property {string} default_branch
 * @property {string} visibility
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
    ...repositoryUpdateFlags
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
    repoName,
    repoDescription,
    homepage,
    defaultBranch,
    visibility
  } = cli.flags

  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    console.error(`${chalk.bgRed('Input error')}: Please provide an organization slug and repository name \n`)
    cli.showHelp()
    return
  }

  if (!repoName) {
    console.error(`${chalk.bgRed('Input error')}: Repository name is required. \n`)
    cli.showHelp()
    return
  }

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    name: repoName,
    description: repoDescription,
    homepage,
    default_branch: defaultBranch,
    visibility
  }
}

/**
 * @typedef RepositoryData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'updateOrgRepo'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|RepositoryData>}
 */
async function updateRepository (orgSlug, input, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  // @ts-ignore
  const result = await handleApiCall(socketSdk.updateOrgRepo(orgSlug, input.name, input), 'listing repositories')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('updateOrgRepo', result, spinner)
  }

  spinner.stop()

  console.log('\n✅ Repository updated successfully \n')

  return {
    data: result.data
  }
}
