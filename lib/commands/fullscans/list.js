/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const list = {
  description: 'List full scans',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' list'

    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Listing full scans...'
      const spinner = ora(spinnerText).start()
      await listOrgFullScan(input.orgSlug, spinner)
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
    throw new InputError('Please specify an organization slug.')
  }

  const orgSlug = cli.input[0] || ''

  return {
    outputJson,
    outputMarkdown,
    orgSlug
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgFullScanList'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function listOrgFullScan (orgSlug, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.getOrgFullScanList(orgSlug), 'Listing full scans')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getOrgFullScanList', result, spinner)
  }

  console.log(`\n Full scans for ${orgSlug}: \n`)
  result.data.results.map(scan => console.log(scan))

  spinner.stop()

  return {
    data: result.data
  }
}
