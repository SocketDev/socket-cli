import { handleAnalytics } from './handle-analytics.mts'
import { FLAG_JSON, FLAG_MARKDOWN } from '../../constants/cli.mts'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { V1_MIGRATION_GUIDE_URL } from '../../constants/socket.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'

import type { MeowFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { webLink } from '../../util/terminal/link.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'

// Flags interface for type safety.
export interface AnalyticsFlags {
  file: string
  json: boolean
  markdown: boolean
}

export interface AnalyticsSelection {
  repoName: string
  scope: string
  time: string
}

export const CMD_NAME = 'analytics'

const description = 'Look up analytics data'

const hidden = false

export const cmdAnalytics = {
  description,
  hidden,
  run,
}

export function parseAnalyticsSelection(
  input: readonly string[],
): AnalyticsSelection {
  const first = input[0]
  if (first === 'org') {
    return {
      __proto__: null,
      repoName: '',
      scope: 'org',
      time: input[1] || '30',
    }
  }
  if (first === 'repo') {
    return {
      __proto__: null,
      repoName: input[1] || '',
      scope: 'repo',
      time: input[2] || '30',
    }
  }
  return {
    __proto__: null,
    repoName: '',
    scope: 'org',
    time: first || '30',
  }
}

export function resolveAnalyticsDays(time: string): 7 | 30 | 90 {
  if (time === '90') {
    return 90
  }
  return time === '30' ? 30 : 7
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
      ...outputFlags,
      file: {
        type: 'string',
        default: '',
        description: 'Path to store result, only valid with --json/--markdown',
      },
    }),
    help: (command: string, { flags }: { flags: MeowFlags }) =>
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
    parentName,
    importMeta,
  })

  const { repoName, scope, time } = parseAnalyticsSelection(cli.input)

  const { file: filepath, json, markdown } = cli.flags

  const dryRun = cli.flags['dryRun']

  const noLegacy =
    !cli.flags['scope'] && !cli.flags['repo'] && !cli.flags['time']

  const hasApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: noLegacy,
      message: `Legacy flags are no longer supported. See the ${webLink(V1_MIGRATION_GUIDE_URL, 'v1 migration guide')}.`,
      fail: 'received legacy flags',
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
      test: !filepath || json || markdown,
      message: `The \`--file\` flag is only valid when using \`${FLAG_JSON}\` or \`${FLAG_MARKDOWN}\``,
      fail: 'bad',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
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
    outputDryRunFetch('analytics data', {
      scope,
      repo: repoName || undefined,
      time: `${time} days`,
    })
    return
  }

  return await handleAnalytics({
    filepath,
    outputKind,
    repo: repoName,
    scope,
    time: resolveAnalyticsDays(time),
  })
}
