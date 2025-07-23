import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListRepos } from './handle-list-repos.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List repositories in an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    all: {
      type: 'boolean',
      default: false,
      description:
        'By default view shows the last n repos. This flag allows you to fetch the entire list. Will ignore --page and --perPage.',
    },
    direction: {
      type: 'string',
      default: 'desc',
      description: 'Direction option',
    },
    interactive: {
      type: 'boolean',
      default: true,
      description:
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config',
    },
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Number of results per page',
    },
    page: {
      type: 'number',
      shortFlag: 'p',
      default: 1,
      description: 'Page number',
    },
    sort: {
      type: 'string',
      shortFlag: 's',
      default: 'created_at',
      description: 'Sorting option',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: repo:list

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --json
  `,
}

export const cmdRepositoryList = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    all,
    direction = 'desc',
    dryRun,
    interactive,
    json,
    markdown,
    org: orgFlag,
  } = cli.flags

  const hasApiToken = hasDefaultToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
    !!dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      pass: 'ok',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad',
    },
    {
      nook: true,
      test: hasApiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token',
    },
    {
      nook: true,
      test: direction === 'asc' || direction === 'desc',
      message: 'The --direction value must be "asc" or "desc"',
      pass: 'ok',
      fail: 'unexpected value',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleListRepos({
    all: Boolean(all),
    direction: direction === 'asc' ? 'asc' : 'desc',
    orgSlug,
    outputKind,
    page: Number(cli.flags['page']) || 1,
    perPage: Number(cli.flags['perPage']) || 30,
    sort: String(cli.flags['sort'] || 'created_at'),
  })
}
