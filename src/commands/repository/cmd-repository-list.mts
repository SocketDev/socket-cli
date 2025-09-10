import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListRepos } from './handle-list-repos.mts'
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
import { hasDefaultApiToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'list'

const description = 'List repositories in an organization'

const hidden = false

export const cmdRepositoryList = {
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
      all: {
        type: 'boolean',
        default: false,
        description:
          'By default view shows the last n repos. This flag allows you to fetch the entire list. Will ignore --page and --per-page.',
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
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --json
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { all, direction = 'desc', json, markdown, org: orgFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const interactive = !!cli.flags['interactive']

  const hasApiToken = hasDefaultApiToken()

  const { 0: orgSlug } = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
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
    {
      nook: true,
      test: direction === 'asc' || direction === 'desc',
      message: 'The --direction value must be "asc" or "desc"',
      fail: 'unexpected value',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
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
