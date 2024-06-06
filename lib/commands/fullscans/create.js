// @ts-nocheck
/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
import { handleApiCall } from '../../utils/api-helpers.js'
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
 * @property {boolean} includeAllIssues
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {boolean} strict
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
    ...validationFlags,
  }

  const cli = meow(`
    Usage
      $ ${name} <name>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} webtorrent
      $ ${name} webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    all: includeAllIssues,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
  } = cli.flags

  return {
    includeAllIssues,
    outputJson,
    outputMarkdown,
    strict,
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'createOrgFullScan'>["data"]} data
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

  console.log(result)

//   console.log('RES: ', result.data)

  spinner.stop()

  return {
    data: result.data
  }
}
