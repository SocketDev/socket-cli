import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { printFlagList } from '../../utils/formatting'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { Ora } from 'ora'

export const create: CliSubcommand = {
  description: 'Create a repository in an organization',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} create`
    const input = setupCommand(name, create.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Creating repository... \n'
      const spinner = ora(spinnerText).start()
      await createRepo(input.orgSlug, input, spinner, apiKey)
    }
  }
}

const repositoryCreationFlags: { [key: string]: any } = {
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
    __proto__: null,
    ...outputFlags,
    ...repositoryCreationFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name} <org slug>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg --repoName=test-repo
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
    repoName,
    repoDescription,
    homepage,
    defaultBranch,
    visibility
  } = cli.flags

  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    console.error(
      `${chalk.white.bgRed('Input error')}: Please provide an organization slug\n`
    )
    cli.showHelp()
    return
  }

  if (!repoName) {
    console.error(
      `${chalk.white.bgRed('Input error')}: Repository name is required.\n`
    )
    cli.showHelp()
    return
  }

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    orgSlug,
    name: repoName,
    description: repoDescription,
    homepage,
    default_branch: defaultBranch,
    visibility
  }
}

async function createRepo(
  orgSlug: string,
  input: CommandContext,
  spinner: Ora,
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(
    socketSdk.createOrgRepo(orgSlug, input),
    'creating repository'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('createOrgRepo', result, spinner)
    return
  }

  spinner.stop()

  console.log('\n✅ Repository created successfully\n')
}
