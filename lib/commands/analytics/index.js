/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const analytics = {
  description: 'Look up analytics data',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' analytics'

    const input = setupCommand(name, analytics.description, argv, importMeta)
    if (input) {
      const spinner = ora('Fetching analytics data').start()
      if (input.scope === 'org') {
        await fetchOrgAnalyticsData(input.time, spinner)
      } else {
        // await fetchRepoAnalyticsData(input.time, spinner)
      }
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {string} scope
 * @property {string} time
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
      $ ${name} <scope> <time>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} org 7
      $ ${name} org 30
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const scope = cli.input[0]

  if (!scope) {
    throw new InputError('Please provide a scope to get analytics data')
  }

  if (!cli.input.length) {
    throw new InputError('Please provide a scope and a time to get analytics data')
  }

  if (scope && !['org', 'repo'].includes(scope)) {
    throw new InputError("The scope must either be 'scope' or 'repo'")
  }
  const time = cli.input[1]

  if (!time) {
    throw new InputError('Please provide a time to get analytics data')
  }

  if (time && !['7', '30', '60'].includes(time)) {
    throw new InputError('The time filter must either be 7, 30 or 60')
  }

    return {
        scope, time
    }
}

/**
 * @typedef AnalyticsData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgAnalytics'>["data"]} data
 */

/**
 * @param {string} time
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void>}
 */
async function fetchOrgAnalyticsData (time, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(socketSdk.getOrgAnalytics(time), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getOrgAnalytics', result, spinner)
  }

  const formattedData = result.data.map(d => {
    const formattedDate = new Date(d.created_at).toLocaleDateString()
    return {
      ...d,
      created_at: formattedDate,
    }
  })
  const data = { ...formattedData.flat(1) }

  console.table(data, ['created_at', 'repository_name', 'total_critical_alerts', 'total_high_alerts', 'total_critical_added', 'total_high_added', 'total_critical_prevented', 'total_high_prevented', 'total_medium_prevented', 'total_low_prevented', 'top_five_alert_types'])
}
