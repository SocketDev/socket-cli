import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const del: CliSubcommand = {
  description: 'Delete a repository in an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} del`
    const input = setupCommand(name, del.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Deleting repository... \n'
      const spinner = ora(spinnerText).start()
      await deleteRepository(input.orgSlug, input.repoName, spinner)
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

  if (!orgSlug || !repoName) {
    console.error(
      `${chalk.bgRed('Input error')}: Please provide an organization slug and repository slug \n`
    )
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
  spinner: Ora
): Promise<void> {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(
    socketSdk.deleteOrgRepo(orgSlug, repoName),
    'deleting repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('deleteOrgRepo', result, spinner)
    return
  }

  spinner.stop()

  console.log('\n✅ Repository deleted successfully\n')
}
