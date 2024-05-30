/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const organizations = {
  description: 'List organizations',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' organizations'

    setupCommand(name, organizations.description, argv, importMeta)
    await fetchOrganizations()
  }
}

// Internal functions

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void}
 */
function setupCommand (name, description, argv, importMeta) {
  meow(`
    Usage
      $ ${name}
  `, {
    argv,
    description,
    importMeta
  })
}

/**
 * @typedef OrganizationsData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrganizations'>["data"]} data
 */

/**
 * @returns {Promise<void|OrganizationsData>}
 */
async function fetchOrganizations () {
  const socketSdk = await setupSdk(getDefaultKey())
  const spinner = ora('Fetching organizations...').start()

  const result = await handleApiCall(socketSdk.getOrganizations(), 'looking up organizations')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getOrganizations', result, spinner)
  }

  spinner.stop()

  const organizations = Object.values(result.data.organizations)
  console.log('List of organizations:')
  organizations.map(o => {
    console.log(`
Name: ${o?.name}
ID: ${o?.id}
Plan: ${o?.plan}
    `)
    return o
  })

  return {
    data: result.data
  }
}
