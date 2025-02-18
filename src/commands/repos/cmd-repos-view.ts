import meowOrExit from 'meow'
import colors from 'yoctocolors-cjs'

import { viewRepo } from './view-repo.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'view',
  description: 'View repositories in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} FakeOrg
  `
}

export const cmdReposView = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags,
    allowUnknownFlags: false
  })

  const repoName = cli.flags['repoName']
  const [orgSlug = ''] = cli.input

  if (!repoName || typeof repoName !== 'string' || !orgSlug) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Repository name using --repoName ${!repoName ? colors.red('(missing!)') : typeof repoName !== 'string' ? colors.red('(invalid!)') : colors.green('(ok)')}\n
    `)
    cli.showHelp()
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await viewRepo(orgSlug, repoName, apiToken)
}
