import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const organizations: CliSubcommand = {
  description: 'List organizations associated with the API key used',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} organizations`
    setupCommand(name, organizations.description, argv, importMeta)
    await fetchOrganizations()
  }
}

// Internal functions

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
) {
  meow(
    `
    Usage
      $ ${name}
  `,
    {
      argv,
      description,
      importMeta
    }
  )
}

async function fetchOrganizations(): Promise<void> {
  const apiKey = getDefaultKey()
  const socketSdk = await setupSdk(apiKey)
  const spinner = ora('Fetching organizations...').start()

  const result = await handleApiCall(
    socketSdk.getOrganizations(),
    'looking up organizations'
  )
  if (result.success === false) {
    handleUnsuccessfulApiResponse('getOrganizations', result, spinner)
    return
  }

  spinner.stop()

  const organizations = Object.values(result.data.organizations)
  if (apiKey) {
    console.log(
      `List of organizations associated with your API key: ${chalk.italic(apiKey)}`
    )
  } else {
    console.log('List of organizations associated with your API key.')
  }

  for (const o of organizations) {
    console.log(`
Name: ${o?.name}
ID: ${o?.id}
Plan: ${o?.plan}
    `)
  }
}
