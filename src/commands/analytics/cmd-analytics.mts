import { logger } from '@socketsecurity/registry/lib/logger'

import { handleAnalytics } from './handle-analytics.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

export const CMD_NAME = 'analytics'

const description = 'Look up analytics data'

const hidden = false

export const cmdAnalytics = {
  description,
  hidden,
  run: run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
      ...outputFlags,
      file: {
        type: 'string',
        description: 'Path to store result, only valid with --json/--markdown',
      },
    },
    help: (command, { flags }) =>
      `
    Usage
      $ ${command} [options] [ "org" | "repo" <reponame>] [TIME]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    The scope is either org or repo level, defaults to org.

    When scope is repo, a repo slug must be given as well.

    The TIME argument must be number 7, 30, or 90 and defaults to 30.

    Options
      ${getFlagListOutput(flags)}

    Examples
      $ ${command} org 7
      $ ${command} repo test-repo 30
      $ ${command} 90
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  // Supported inputs:
  // - []        (no args)
  // - ['org']
  // - ['org', '30']
  // - ['repo', 'name']
  // - ['repo', 'name', '30']
  // - ['30']
  // Validate final values in the next step
  let scope = 'org'
  let time = '30'
  let repoName = ''

  if (cli.input[0] === 'org') {
    if (cli.input[1]) {
      time = cli.input[1]
    }
  } else if (cli.input[0] === 'repo') {
    scope = 'repo'
    if (cli.input[1]) {
      repoName = cli.input[1]
    }
    if (cli.input[2]) {
      time = cli.input[2]
    }
  } else if (cli.input[0]) {
    time = cli.input[0]
  }

  const { file, json, markdown } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const noLegacy =
    !cli.flags['scope'] && !cli.flags['repo'] && !cli.flags['time']

  const hasApiToken = hasDefaultToken()

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: noLegacy,
      message: 'Legacy flags are no longer supported. See v1 migration guide.',
      fail: `received legacy flags`,
    },
    {
      nook: true,
      test: scope === 'org' || !!repoName,
      message: 'When scope=repo, repo name should be the second argument',
      fail: 'missing',
    },
    {
      nook: true,
      test:
        scope === 'org' ||
        (repoName !== '7' && repoName !== '30' && repoName !== '90'),
      message: 'When scope is repo, the second arg should be repo, not time',
      fail: 'missing',
    },
    {
      test: time === '7' || time === '30' || time === '90',
      message: 'The time filter must either be 7, 30 or 90',
      fail: 'invalid range set, see --help for command arg details.',
    },
    {
      nook: true,
      test: !file || !!json || !!markdown,
      message:
        'The `--file` flag is only valid when using `--json` or `--markdown`',
      fail: 'bad',
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      fail: 'bad',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  return await handleAnalytics({
    scope,
    time: time === '90' ? 90 : time === '30' ? 30 : 7,
    repo: repoName,
    outputKind,
    filePath: String(file || ''),
  })
}
