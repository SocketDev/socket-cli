import { logger } from '@socketsecurity/lib/logger'

import { handleListRepos } from './handle-list-repos.mts'
import {
  DRY_RUN_BAILING_NOW,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mjs'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { determineOrgSlug } from '../../utils/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type { Direction } from './types.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

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
  { parentName }: CliCommandContext,
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
        default: '',
        description:
          'Force override the organization slug, overrides the default org from config',
      },
      perPage: {
        type: 'number',
        default: 30,
        description: 'Number of results per page',
        shortFlag: 'pp',
      },
      page: {
        type: 'number',
        default: 1,
        description: 'Page number',
        shortFlag: 'p',
      },
      sort: {
        type: 'string',
        default: 'created_at',
        description: 'Sorting option',
        shortFlag: 's',
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
    parentName,
    importMeta,
  })

  const {
    all,
    direction = 'desc',
    dryRun,
    interactive,
    json,
    markdown,
    org: orgFlag,
    page,
    perPage,
    sort,
  } = cli.flags as unknown as {
    all: boolean
    direction: Direction
    dryRun: boolean
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    page: number
    perPage: number
    sort: string
  }

  const hasApiToken = hasDefaultApiToken()

  const { 0: orgSlug } = await determineOrgSlug(orgFlag, interactive, dryRun)

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
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
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
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleListRepos({
    all,
    direction,
    orgSlug,
    outputKind,
    page,
    perPage,
    sort,
  })
}
