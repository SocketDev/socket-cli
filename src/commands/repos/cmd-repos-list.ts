import colors from 'yoctocolors-cjs'

import { listRepos } from './list-repos'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List repositories in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
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
    },
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
  `
}

export const cmdReposList = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - At least one TARGET (e.g. \`.\` or \`./package.json\`\n`)
    return
  }

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await listRepos({
    apiToken,
    outputJson: Boolean(cli.flags['json']),
    outputMarkdown: Boolean(cli.flags['markdown']),
    orgSlug,
    sort: String(cli.flags['sort'] || 'created_at'),
    direction: cli.flags['direction'] === 'asc' ? 'asc' : 'desc',
    page: Number(cli.flags['page']) || 1,
    per_page: Number(cli.flags['perPage']) || 30
  })
}
