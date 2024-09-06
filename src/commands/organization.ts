import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { AuthError } from '../utils/errors'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const organizations: CliSubcommand = {
  description: 'List organizations associated with the API key used',
  async run(argv, importMeta, { parentName }) {
    setupCommand(
      `${parentName} organizations`,
      organizations.description,
      argv,
      importMeta
    )
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
  if (!apiKey) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
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

  console.log(
    `List of organizations associated with your API key: ${chalk.italic(apiKey)}`
  )

  for (const o of organizations) {
    console.log(`
Name: ${o?.name}
ID: ${o?.id}
Plan: ${o?.plan}
    `)
  }
}
