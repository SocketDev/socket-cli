/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const create = {
  description: 'Create a full scan',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' create'

    const input = setupCommand(name, create.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Creating a full scan...'
      const spinner = ora(spinnerText).start()
      await createFullScan(spinner)
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
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
      $ ${name}

    Options
      ${printFlagList(flags, 6)}
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

  return {
    outputJson,
    outputMarkdown
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'CreateOrgFullScan'>["data"]} data
 */

/**
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function createFullScan (spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.createOrgFullScan('SocketDev', {
    repo: 'socket-cli-js',
    branch: 'master',
    make_default_branch: true,
    set_as_pending_head: false,
    tmp: true
  }, ['package.json']), 'Creating full scan')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('CreateOrgFullScan', result, spinner)
  }

  console.log('\n Full scan created successfully \n')
  console.log('Full scan details: \n')
  console.log(result.data)

  spinner.stop()

  return {
    data: result.data
  }
}
