import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { commonFlags, outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const view: CliSubcommand = {
  description: 'View repositories in an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} view`
    const input = setupCommand(name, view.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Fetching repository... \n'
      const spinner = ora(spinnerText).start()
      await viewRepository(input.orgSlug, input.repositoryName, spinner, apiKey)
    }
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  repositoryName: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    __proto__: null,
    ...commonFlags,
    ...outputFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} <org slug>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  let showHelp = cli.flags['help']
  if (!cli.input[0]) {
    showHelp = true
    console.error(
      `${chalk.white.bgRed('Input error')}: Please provide an organization slug and repository name\n`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const { 0: orgSlug = '', 1: repositoryName = '' } = cli.input
  return <CommandContext>{
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    orgSlug,
    repositoryName
  }
}

async function viewRepository(
  orgSlug: string,
  repoName: string,
  spinner: Ora,
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(
    socketSdk.getOrgRepo(orgSlug, repoName),
    'fetching repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepo', result, spinner)
    return
  }

  spinner.stop()

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'name', name: chalk.magenta('Name') },
      { field: 'visibility', name: chalk.magenta('Visibility') },
      { field: 'default_branch', name: chalk.magenta('Default branch') },
      { field: 'homepage', name: chalk.magenta('Homepage') },
      { field: 'archived', name: chalk.magenta('Archived') },
      { field: 'created_at', name: chalk.magenta('Created at') }
    ]
  }

  console.log(`${chalkTable(options, [result.data])}\n`)
}
