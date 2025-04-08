import assert from 'node:assert'

import { logger } from '@socketsecurity/registry/lib/logger'

import { displayAnalytics } from './display-analytics'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

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
        'Filepath to save output. Only valid with --json/--markdown. Defaults to stdout.'
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

    API Token Requirements
      - Quota: 1 unit
      - Permissions: report:write

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

  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      test: scope === 'org' || scope === 'repo',
      message: 'Scope must be "repo" or "org"',
      pass: 'ok',
      fail: 'bad'
    },
    {
      test: time === 7 || time === 30 || time === 90,
      message: 'The time filter must either be 7, 30 or 90',
      pass: 'ok',
      fail: 'bad'
    },
    {
      nook: true,
      test: scope === 'org' || !!repo,
      message: 'When scope=repo, repo name should be set through --repo',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: file === '-' || !!json || !!markdown,
      message:
        'The `--file` flag is only valid when using `--json` or `--markdown`',
      pass: 'ok',
      fail: 'bad'
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
    },
    {
      nook: true,
      test: !!apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  assert(assertScope(scope))
  assert(assertTime(time))

  return await displayAnalytics({
    scope,
    time,
    repo: String(repo || ''),
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    filePath: String(file || '')
  })
}

function assertScope(scope: unknown): scope is 'org' | 'repo' {
  return scope === 'org' || scope === 'repo'
}

function assertTime(time: unknown): time is 7 | 30 | 90 {
  return time === 7 || time === 30 || time === 90
}
