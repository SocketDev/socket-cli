import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListScans } from './handle-list-scans.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { isTestingV1 } from '../../utils/config.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List the scans for an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    branch: {
      type: 'string',
      description: 'Filter to show only scans with this branch name'
    },
    direction: {
      type: 'string',
      shortFlag: 'd',
      default: 'desc',
      description: 'Direction option (`desc` or `asc`) - Default is `desc`'
    },
    fromTime: {
      type: 'string',
      shortFlag: 'f',
      default: '',
      description: 'From time - as a unix timestamp'
    },
    interactive: {
      type: 'boolean',
      default: true,
      description:
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.'
    },
    page: {
      type: 'number',
      shortFlag: 'p',
      default: 1,
      description: 'Page number - Default is 1'
    },
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Results per page - Default is 30'
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config'
    },
    repo: {
      type: 'string',
      description: 'Filter to show only scans with this repository name'
    },
    sort: {
      type: 'string',
      shortFlag: 's',
      default: 'created_at',
      description:
        'Sorting option (`name` or `created_at`) - default is `created_at`'
    },
    untilTime: {
      type: 'string',
      shortFlag: 'u',
      default: '',
      description: 'Until time - as a unix timestamp'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command}${isTestingV1() ? '' : ' <org slug>'}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:list

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}${isTestingV1() ? '' : ' FakeOrg'}
  `
}

export const cmdScanList: CliSubcommand = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
) {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const {
    branch,
    dryRun,
    interactive,
    json,
    markdown,
    org: orgFlag,
    repo
  } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const [orgSlug, defaultOrgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    !!interactive,
    !!dryRun
  )

  const hasApiToken = hasDefaultToken()

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: !!defaultOrgSlug,
      test: !!orgSlug && orgSlug !== '.',
      message: isTestingV1()
        ? 'Org name by default setting, --org, or auto-discovered'
        : 'Org name must be the first argument',
      pass: 'ok',
      fail:
        orgSlug === '.'
          ? 'dot is an invalid org, most likely you forgot the org name here?'
          : 'missing'
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    },
    {
      nook: true,
      test: !!hasApiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    }
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
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
    per_page: Number(cli.flags['perPage'] || 30),
    repo: repo ? String(repo) : '',
    sort: String(cli.flags['sort'] || '')
  })
}
