import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { displayAnalytics } from './display-analytics'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'analytics',
  description: `Look up analytics data`,
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    file: {
      type: 'string',
      shortFlag: 'f',
      default: '-',
      description:
        'Path to a local file to save the output. Only valid with --json/--markdown. Defaults to stdout.'
    },
    repo: {
      type: 'string',
      shortFlag: 'r',
      default: '',
      description: 'Name of the repository. Only valid when scope=repo'
    },
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
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const { file, json, markdown, repo, scope, time } = cli.flags

  const badScope = scope !== 'org' && scope !== 'repo'
  const badTime = time !== 7 && time !== 30 && time !== 90
  const badRepo = scope === 'repo' && !repo
  const badFile = file !== '-' && !json && !markdown
  const badFlags = json && markdown

  if (badScope || badTime || badRepo || badFile || badFlags) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Scope must be "repo" or "org" ${badScope ? colors.red('(bad!)') : colors.green('(ok)')}\n
      - The time filter must either be 7, 30 or 90 ${badTime ? colors.red('(bad!)') : colors.green('(ok)')}\n
      ${scope === 'repo' ? `- Repository name using --repo when scope is "repo" ${badRepo ? colors.red('(bad!)') : colors.green('(ok)')}` : ''}\n
      ${badFlags ? `- The \`--json\` and \`--markdown\` flags can not be used at the same time ${badFlags ? colors.red('(bad!)') : colors.green('(ok)')}` : ''}\n
      ${badFile ? `- The \`--file\` flag is only valid when using \`--json\` or \`--markdown\` ${badFile ? colors.red('(bad!)') : colors.green('(ok)')}` : ''}\n
    `
        .trim()
        .split('\n')
        .filter(s => !!s.trim())
        .join('\n') + '\n'
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  return await displayAnalytics({
    scope,
    time,
    repo: String(repo || ''),
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    filePath: String(file || '')
  })
}
