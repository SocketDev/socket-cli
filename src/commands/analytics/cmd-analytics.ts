import { logger } from '@socketsecurity/registry/lib/logger'

import { displayAnalytics } from './display-analytics'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { isTestingV1 } from '../../utils/config'
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
  help: (command, { flags }) =>
    `
    Usage
      $ ${command} ${isTestingV1() ? '[ org | repo <reponame>] [time]' : '--scope=<scope> --time=<time filter>'}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: report:write

    ${isTestingV1() ? '' : 'Default parameters are set to show the organization-level analytics over the'}
    ${isTestingV1() ? '' : 'last 7 days.'}

    ${isTestingV1() ? 'The scope is either org or repo level, defaults to org.' : ''}

    ${isTestingV1() ? 'When scope is repo, a repo slug must be given as well.' : ''}

    ${isTestingV1() ? 'The time argument must be number 7, 30, or 90 and defaults to 7.' : ''}

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${command} ${isTestingV1() ? 'org 7' : '--scope=org --time=7'}
      $ ${command} ${isTestingV1() ? 'repo test-repo 30' : '--scope=org --time=30'}
      $ ${command} ${isTestingV1() ? '90' : '--scope=repo --repo=test-repo --time=30'}
  `
      // Drop consecutive empty lines. Temporarily necessary to deal with v1 prep.
      .replace(/\n(?: *\n)+/g, '\n\n')
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

  const { file, json, markdown } = cli.flags

  // In v1 mode support:
  // - []        (no args)
  // - ['org']
  // - ['org', '30']
  // - ['repo', 'name']
  // - ['repo', 'name', '30']
  // - ['30']
  // Validate final values in the next step
  let scope = 'org'
  let time = isTestingV1() ? '7' : 7
  let repoName = ''
  if (isTestingV1()) {
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
  } else {
    if (cli.flags['scope']) {
      scope = String(cli.flags['scope'] || '')
    }
    if (scope === 'repo') {
      repoName = String(cli.flags['repoName'] || '')
    }
    if (cli.flags['time']) {
      time = Number(cli.flags['time'] || 7)
    }
  }

  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      // In v1 this can't go wrong anymore since the unknown value goes to time
      nook: !isTestingV1(),
      test: scope === 'org' || scope === 'repo',
      message: 'Scope must be "repo" or "org"',
      pass: 'ok',
      fail: 'bad'
    },
    {
      nook: true,
      test: scope === 'org' || !!repoName,
      message: isTestingV1()
        ? 'When scope=repo, repo name should be the second argument'
        : 'When scope=repo, repo name should be set through --repo',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test:
        scope === 'org' ||
        (isTestingV1() &&
          repoName !== '7' &&
          repoName !== '30' &&
          repoName !== '90'),
      message: 'Missing the repo name as second argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      test: isTestingV1()
        ? time === '7' || time === '30' || time === '90'
        : time === 7 || time === 30 || time === 90,
      message: 'The time filter must either be 7, 30 or 90',
      pass: 'ok',
      fail: isTestingV1()
        ? 'invalid range set, see --help for command arg details.'
        : 'bad'
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

  return await displayAnalytics({
    scope,
    time: time === '90' ? 90 : time === '30' ? 30 : 7,
    repo: repoName,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    filePath: String(file || '')
  })
}
