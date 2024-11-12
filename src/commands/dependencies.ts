import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { commonFlags, outputFlags } from '../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { AuthError } from '../utils/errors'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const dependencies: CliSubcommand = {
  description:
    'Search for any dependency that is being used in your organization',
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' dependencies'

    const input = setupCommand(name, dependencies.description, argv, importMeta)
    if (input) {
      await searchDeps(input)
    }
  }
}

const dependenciesFlags = {
  limit: {
    type: 'number',
    shortFlag: 'l',
    default: 50,
    description: 'Maximum number of dependencies returned'
  },
  offset: {
    type: 'number',
    shortFlag: 'o',
    default: 0,
    description: 'Page number'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  limit: number
  offset: number
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...dependenciesFlags,
    ...outputFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name}

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name}
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
    limit,
    markdown: outputMarkdown,
    offset
  } = cli.flags

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    limit,
    offset
  }
}

async function searchDeps({
  limit,
  offset,
  outputJson
}: CommandContext): Promise<void> {
  const apiKey = getDefaultKey()
  if (!apiKey) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  const spinnerText = 'Searching dependencies...'
  const spinner = ora(spinnerText).start()

  const socketSdk = await setupSdk(apiKey)

  const result = await handleApiCall(
    socketSdk.searchDependencies({ limit, offset }),
    'Searching dependencies'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('searchDependencies', result, spinner)
    return
  }

  spinner.stop()

  console.log('Organization dependencies:\n')

  if (outputJson) {
    console.log(result.data)
    return
  }

  const options = {
    columns: [
      { field: 'namespace', name: chalk.cyan('Namespace') },
      { field: 'name', name: chalk.cyan('Name') },
      { field: 'version', name: chalk.cyan('Version') },
      { field: 'repository', name: chalk.cyan('Repository') },
      { field: 'branch', name: chalk.cyan('Branch') },
      { field: 'type', name: chalk.cyan('Type') },
      { field: 'direct', name: chalk.cyan('Direct') }
    ]
  }

  console.log(chalkTable(options, result.data.rows))
}
