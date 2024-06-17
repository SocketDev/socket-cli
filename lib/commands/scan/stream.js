/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const stream = {
  description: 'Stream the output of a scan',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' stream'

    const input = setupCommand(name, stream.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Streaming scan... \n'
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
      $ ${name} <org slug> <scan ID> <path to output file>

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
    console.error(`${chalk.bgRed('Input error')}: Please specify an organization slug and a scan ID.\n`)
    cli.showHelp()
    return
  }

  const [orgSlug = '', fullScanId = '', file] = cli.input

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
 * @param {string | undefined} file
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|FullScanData>}
 */
async function getOrgFullScan (orgSlug, fullScanId, file, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.getOrgFullScan(orgSlug, fullScanId, file), 'Streaming a scan')

  if (!result?.success) {
    return handleUnsuccessfulApiResponse('getOrgFullScan', result, spinner)
  }

  spinner.stop()

  console.log(file ? `\nFull scan details written to ${file} \n` : '\nFull scan details: \n')

  return {
    data: result.data
  }
}
