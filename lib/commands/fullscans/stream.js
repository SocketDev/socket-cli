/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const stream = {
  description: 'Stream a full scan',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' stream'

    const input = setupCommand(name, stream.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Streaming full scan... \n'
      const spinner = ora(spinnerText).start()
      await getOrgFullScan(input.orgSlug, input.fullScanId, input.file, spinner)
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
 * @property {string | undefined} file
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
      $ ${name} <org slug> <full scan ID> <file>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg 000aaaa1-0000-0a0a-00a0-00a0000000a0 ./stream.txt
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
  const file = cli.input[2]

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    fullScanId,
    file
  }
}

/**
 * @typedef FullScanData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgFullScan'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {string} fullScanId
 * @param {string|undefined} file
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|FullScanData>}
 */
async function getOrgFullScan (orgSlug, fullScanId, file, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getOrgFullScan(orgSlug, fullScanId, file), 'Streaming a full scan')

  if (!result?.success) {
    return handleUnsuccessfulApiResponse('getOrgFullScan', result, spinner)
  }

  spinner.stop()

  console.log(file ? `\nFull scan details written to ${file} \n` : '\nFull scan details: \n')

  return {
    data: result.data
  }
}
