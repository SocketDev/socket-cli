import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/formatting'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

export const update: CliSubcommand = {
  description: 'Update a repository in an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} update`
    const input = setupCommand(name, update.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultToken()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Updating repository... \n'
      const spinner = new Spinner({ text: spinnerText }).start()
      await updateRepository(input.orgSlug, input, spinner, apiKey)
    }
  }
}

const repositoryUpdateFlags: { [key: string]: any } = {
  repoName: {
    type: 'string',
    shortFlag: 'n',
    default: '',
    description: 'Repository name'
  },
  repoDescription: {
    type: 'string',
    shortFlag: 'd',
    default: '',
    description: 'Repository description'
  },
  homepage: {
    type: 'string',
    shortFlag: 'h',
    default: '',
    description: 'Repository url'
  },
  defaultBranch: {
    type: 'string',
    shortFlag: 'b',
    default: 'main',
    description: 'Repository default branch'
  },
  visibility: {
    type: 'string',
    shortFlag: 'v',
    default: 'private',
    description: 'Repository visibility (Default Private)'
  }
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  orgSlug: string
  name: string
  description: string
  homepage: string
  default_branch: string
  visibility: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags,
    ...repositoryUpdateFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name} <org slug>

    Options
      ${getFlagListOutput(flags, 6)}

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
  const { repoName } = cli.flags
  const [orgSlug = ''] = cli.input
  let showHelp = cli.flags['help']
  if (!orgSlug) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide an organization slug and repository name.`
    )
  } else if (!repoName) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Repository name is required.`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  return <CommandContext>{
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    orgSlug,
    name: repoName,
    description: cli.flags['repoDescription'],
    homepage: cli.flags['homepage'],
    default_branch: cli.flags['defaultBranch'],
    visibility: cli.flags['visibility']
  }
}

async function updateRepository(
  orgSlug: string,
  input: CommandContext,
  spinner: Spinner,
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(
    socketSdk.updateOrgRepo(orgSlug, input.name, input),
    'updating repository'
  )

  if (result.success) {
    spinner.success('Repository updated successfully')
  } else {
    handleUnsuccessfulApiResponse('updateOrgRepo', result, spinner)
  }
}
