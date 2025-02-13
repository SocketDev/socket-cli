import meowOrDie from 'meow'
import colors from 'yoctocolors-cjs'

import { runAnalytics } from './run-analytics.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError, InputError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'
import type { CommandContext } from '../types.ts'

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
  help: (parentName, { commandName, flags }) => `
    Usage
      $ ${parentName} ${commandName} --scope=<scope> --time=<time filter>

    Default parameters are set to show the organization-level analytics over the
    last 7 days.

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${parentName} ${commandName} --scope=org --time=7
      $ ${parentName} ${commandName} --scope=org --time=30
      $ ${parentName} ${commandName} --scope=repo --repo=test-repo --time=30
  `
}

export const analyticsCommand = {
  description: config.description,
  hidden: config.hidden,
  run: run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrDie(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  const { repo, scope, time } = cli.flags

  if (scope !== 'org' && scope !== 'repo') {
    throw new InputError("The scope must either be 'org' or 'repo'")
  }

  if (time !== 7 && time !== 30 && time !== 90) {
    throw new InputError('The time filter must either be 7, 30 or 90')
  }

  if (scope === 'repo' && !repo) {
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide a repository name when using the repository scope.`
    )
    cli.showHelp()
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API token.'
    )
  }

  return await runAnalytics(apiToken, {
    scope,
    time,
    repo,
    outputJson: cli.flags['json'],
    file: cli.flags['file']
  } as CommandContext)
}
