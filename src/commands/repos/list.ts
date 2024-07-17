import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const list: CliSubcommand = {
  description: 'List repositories in an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} list`
    const input = setupCommand(name, list.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Listing repositories... \n'
      const spinner = ora(spinnerText).start()
      await listOrgRepos(input.orgSlug, input, spinner)
    }
  }
}

const listRepoFlags: { [key: string]: any } = {
  sort: {
    type: 'string',
    shortFlag: 's',
    default: 'created_at',
    description: 'Sorting option'
  },
  direction: {
    type: 'string',
    default: 'desc',
    description: 'Direction option'
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Number of results per page'
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  sort: string
  direction: string
  per_page: number
  page: number
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...outputFlags,
    ...listRepoFlags
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

  const {
    json: outputJson,
    markdown: outputMarkdown,
    perPage,
    sort,
    direction,
    page
  } = cli.flags

  if (!cli.input[0]) {
    console.error(
      `${chalk.bgRed('Input error')}: Please provide an organization slug \n`
    )
    cli.showHelp()
    return
  }

  const { 0: orgSlug = '' } = cli.input

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    sort,
    direction,
    page,
    per_page: perPage
  }
}

async function listOrgRepos(
  orgSlug: string,
  input: CommandContext,
  spinner: Ora
): Promise<void> {
  const socketSdk = await setupSdk(getDefaultKey())
  const result = await handleApiCall(
    socketSdk.getOrgRepoList(orgSlug, input),
    'listing repositories'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgRepoList', result, spinner)
    return
  }

  spinner.stop()

  const options = {
    columns: [
      { field: 'id', name: chalk.magenta('ID') },
      { field: 'name', name: chalk.magenta('Name') },
      { field: 'visibility', name: chalk.magenta('Visibility') },
      { field: 'default_branch', name: chalk.magenta('Default branch') },
      { field: 'archived', name: chalk.magenta('Archived') }
    ]
  }

  console.log(`${chalkTable(options, result.data.results)}\n`)
}
