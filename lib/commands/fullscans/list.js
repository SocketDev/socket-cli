// @ts-nocheck
/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
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
      const spinnerText = 'Listinga full scan...'
      const spinner = ora(spinnerText).start()
      await listOrgFullScan(input.orgSlug, spinner)
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
    ...outputFlags,
    ...validationFlags,
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
    all: includeAllIssues,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
  } = cli.flags

  if (cli.input.length < 1) {
    throw new InputError('Please specify an organization slug.')
  }

  const orgSlug = cli.input[0] || ''

  return {
    includeAllIssues,
    outputJson,
    outputMarkdown,
    strict,
    orgSlug
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'listOrgFullScan'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function listOrgFullScan (orgSlug, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.listOrgFullScan(orgSlug), 'Deleting full scan')

  console.log(result)

  if (!result.success) {
    return handleUnsuccessfulApiResponse('listOrgFullScan', result, spinner)
  }

  spinner.stop()

  return {
    data: result.data
  }
}
