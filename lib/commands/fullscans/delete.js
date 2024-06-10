/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const del = {
  description: 'Delete a full scan',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' del'

    const input = setupCommand(name, del.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Deleting full scan...'
      const spinner = ora(spinnerText).start()
      await deleteOrgFullScan(input.orgSlug, input.fullScanId, spinner)
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} fullScanId
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
      $ ${name} <org slug> <full scan ID>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    json: outputJson,
    markdown: outputMarkdown,
  } = cli.flags

  if (cli.input.length < 2) {
    throw new InputError('Please specify an organization slug and a full scan ID.')
  }

  const orgSlug = cli.input[0] || ''
  const fullScanId = cli.input[1] || ''

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    fullScanId
  }
}

/**
 * @typedef FullScanData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'deleteOrgFullScan'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {string} fullScanId
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|FullScanData>}
 */
async function deleteOrgFullScan (orgSlug, fullScanId, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.deleteOrgFullScan(orgSlug, fullScanId), 'Deleting full scan')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('deleteOrgFullScan', result, spinner)
  }

  console.log('\n Full scan deleted successfully. \n')

  spinner.stop()

  return {
    data: result.data
  }
}
