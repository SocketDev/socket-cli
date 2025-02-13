import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../utils/api'
import { AuthError } from '../utils/errors'
import { getDefaultToken, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const description = 'List organizations associated with the API key used'

export const organizationCommand: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    setupCommand(`${parentName} organizations`, description, argv, importMeta)
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
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  const spinner = new Spinner({ text: 'Fetching organizations...' }).start()
  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrganizations(),
    'looking up organizations'
  )

  if (result.success === false) {
    handleUnsuccessfulApiResponse('getOrganizations', result, spinner)
    return
  }

  spinner.stop(
    `List of organizations associated with your API key: ${colors.italic(apiToken)}`
  )

  const organizations = Object.values(result.data.organizations)
  for (const o of organizations) {
    console.log(`
Name: ${o?.name}
ID: ${o?.id}
Plan: ${o?.plan}
    `)
  }
}
