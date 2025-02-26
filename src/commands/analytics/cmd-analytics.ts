import colors from 'yoctocolors-cjs'

import { displayAnalytics } from './display-analytics.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'analytics',
  description: `Look up analytics data`,
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    scope: {
      type: 'string',
      shortFlag: 's',
      default: 'org',
      description:
        "Scope of the analytics data - either 'org' or 'repo', default: org"
    },
    time: {
      type: 'number',
      shortFlag: 't',
      default: 7,
      description: 'Time filter - either 7, 30 or 90, default: 7'
    },
    repo: {
      type: 'string',
      shortFlag: 'r',
      default: '',
      description: 'Name of the repository'
    },
    file: {
      type: 'string',
      shortFlag: 'f',
      default: '',
      description: 'Path to a local file to save the output'
    }
  },
  help: (command, { flags }) => `
    Usage
      $ ${command} --scope=<scope> --time=<time filter>

    Default parameters are set to show the organization-level analytics over the
    last 7 days.

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${command} --scope=org --time=7
      $ ${command} --scope=org --time=30
      $ ${command} --scope=repo --repo=test-repo --time=30
  `
}

export const cmdAnalytics = {
  description: config.description,
  hidden: config.hidden,
  run: run
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

  const { repo, scope, time } = cli.flags

  const badScope = scope !== 'org' && scope !== 'repo'
  const badTime = time !== 7 && time !== 30 && time !== 90
  const badRepo = scope === 'repo' && !repo

  if (badScope || badTime || badRepo) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Scope must be "repo" or "org" ${badScope ? colors.red('(bad!)') : colors.green('(ok)')}\n
      - The time filter must either be 7, 30 or 90 ${badTime ? colors.red('(bad!)') : colors.green('(ok)')}\n
      - Repository name using --repo when scope is "repo" ${badRepo ? colors.red('(bad!)') : colors.green('(ok)')}\n
    `)
    process.exitCode = 2 // bad input
    return
  }

  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API token.'
    )
  }

  return await displayAnalytics({
    apiToken,
    scope,
    time,
    repo: String(repo || ''),
    outputJson: Boolean(cli.flags['json']),
    filePath: String(cli.flags['file'] || '')
  })
}
