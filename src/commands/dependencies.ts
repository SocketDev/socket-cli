import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const dependencies: CliSubcommand = {
  description:
    'Search for any dependency that is being used in your organization',
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' dependencies'

    const input = setupCommand(name, dependencies.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Searching dependencies...'
      const spinner = ora(spinnerText).start()
      await searchDeps(input, spinner)
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
    ...outputFlags,
    ...dependenciesFlags
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
    markdown: outputMarkdown,
    limit,
    offset
  } = cli.flags

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    limit,
    offset
  }
}

async function searchDeps(
  { limit, offset, outputJson }: CommandContext,
  spinner: Ora
): Promise<void> {
  const socketSdk = await setupSdk(getDefaultKey())
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

  console.log(`${chalkTable(options, result.data.rows)}\n`)
}
