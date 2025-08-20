import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListScans } from './handle-list-scans.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type {
  CliCommandConfig,
  CliSubcommand,
} from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

export const CMD_NAME = 'list'

const description = 'List the scans for an organization'

const hidden = false

export const cmdScanList: CliSubcommand = {
  description,
  hidden,
  run,
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
      branch: {
        type: 'string',
        description: 'Filter to show only scans with this branch name',
      },
      direction: {
        type: 'string',
        shortFlag: 'd',
        default: 'desc',
        description: 'Direction option (`desc` or `asc`) - Default is `desc`',
      },
      fromTime: {
        type: 'string',
        shortFlag: 'f',
        default: '',
        description: 'From time - as a unix timestamp',
      },
      interactive: {
        type: 'boolean',
        default: true,
        description:
          'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
      },
      page: {
        type: 'number',
        shortFlag: 'p',
        default: 1,
        description: 'Page number - Default is 1',
      },
      perPage: {
        type: 'number',
        shortFlag: 'pp',
        default: 30,
        description: 'Results per page - Default is 30',
      },
      org: {
        type: 'string',
        description:
          'Force override the organization slug, overrides the default org from config',
      },
      sort: {
        type: 'string',
        shortFlag: 's',
        default: 'created_at',
        description:
          'Sorting option (`name` or `created_at`) - default is `created_at`',
      },
      untilTime: {
        type: 'string',
        shortFlag: 'u',
        default: '',
        description: 'Until time - as a unix timestamp',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] [REPO [BRANCH]]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Optionally filter by REPO. If you specify a repo, you can also specify a
    branch to filter by. (Note: If you don't specify a repo then you must use
    \`--branch\` to filter by branch across all repos).

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} webtools badbranch --markdown
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { branch: branchFlag, json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const interactive = !!cli.flags['interactive']

  const noLegacy = !cli.flags['repo']

  const [repo = '', branchArg = ''] = cli.input

  const branch = String(branchFlag || branchArg || '')

  const hasApiToken = hasDefaultToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

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
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'dot is an invalid org, most likely you forgot the org name here?',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
    {
      nook: true,
      test: !branchFlag || !branchArg,
      message:
        'You should not set --branch and also give a second arg for branch name',
      fail: 'received flag and second arg',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleListScans({
    branch: branch ? String(branch) : '',
    direction: String(cli.flags['direction'] || ''),
    from_time: String(cli.flags['fromTime'] || ''),
    orgSlug,
    outputKind,
    page: Number(cli.flags['page'] || 1),
    perPage: Number(cli.flags['perPage'] || 30),
    repo: repo ? String(repo) : '',
    sort: String(cli.flags['sort'] || ''),
  })
}
