import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

export const del: CliSubcommand = {
  description: 'Delete a repository in an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} del`
    const input = setupCommand(name, del.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultToken()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Deleting repository... \n'
      const spinner = new Spinner({ text: spinnerText }).start()
      await deleteRepository(input.orgSlug, input.repoName, spinner, apiKey)
    }
  }
}

// Internal functions

type CommandContext = {
  orgSlug: string
  repoName: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const cli = meow(
    `
    Usage
      $ ${name} <org slug> <repo slug>

    Examples
      $ ${name} FakeOrg test-repo
  `,
    {
      argv,
      description,
      importMeta
    }
  )
  const { 0: orgSlug = '', 1: repoName = '' } = cli.input
  let showHelp = cli.flags['help']
  if (!orgSlug || !repoName) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide an organization slug and repository slug.`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  return {
    orgSlug,
    repoName
  }
}

async function deleteRepository(
  orgSlug: string,
  repoName: string,
  spinner: Spinner,
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(
    socketSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  if (result.success) {
    spinner.success('Repository deleted successfully')
  } else {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result, spinner)
  }
}
