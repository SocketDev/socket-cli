/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const del = {
  description: 'Delete a repository in an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' del'

    const input = setupCommand(name, del.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Deleting repository... \n'
      const spinner = ora(spinnerText).start()
      await deleteRepository(input.orgSlug, input.repoName, spinner)
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {string} orgSlug
 * @property {string} repoName
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
      $ ${name} <org slug> <repo slug>

    Examples
      $ ${name} FakeOrg test-repo
  `, {
    argv,
    description,
    importMeta
  })

  const [orgSlug = '', repoName = ''] = cli.input

  if (!orgSlug || !repoName) {
    console.error(`${chalk.bgRed('Input error')}: Please provide an organization slug and repository slug \n`)
    cli.showHelp()
    return
  }

  return {
    orgSlug,
    repoName
  }
}

/**
 * @typedef RepositoryData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'deleteOrgRepo'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {string} repoName
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|RepositoryData>}
 */
async function deleteRepository (orgSlug, repoName, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.deleteOrgRepo(orgSlug, repoName), 'deleting repository')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('deleteOrgRepo', result, spinner)
  }

  spinner.stop()

  console.log('\n✅ Repository deleted successfully \n')

  return {
    data: result.data
  }
}
