// @ts-nocheck
/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
// import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
// import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const view = {
  description: 'View repositories in an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' view'

    const input = setupCommand(name, view.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Fetching repository... \n'
      const spinner = ora(spinnerText).start()
      await viewRepository(input.orgSlug, input, spinner)
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
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
    throw new InputError(`Please specify an organization slug. \n
Example:
socket scan list FakeOrg
`)
  }

  const orgSlug = cli.input[0] || ''

  return {
    outputJson,
    outputMarkdown,
    orgSlug
  }
}

/**
 * @typedef RepositoryData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgFullScanList'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|RepositoryData>}
 */
async function viewRepository (orgSlug, input, spinner) {
  // const socketSdk = await setupSdk(getDefaultKey())
  console.log(input)

//   return {
//     // data: result.data
//   }
}
