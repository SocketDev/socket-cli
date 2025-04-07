import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListScans } from './handle-list-scans'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type {
  CliCommandConfig,
  CliSubcommand
} from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'list',
  description: 'List the scans for an organization',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    sort: {
      type: 'string',
      shortFlag: 's',
      default: 'created_at',
      description:
        'Sorting option (`name` or `created_at`) - default is `created_at`'
    },
    direction: {
      type: 'string',
      shortFlag: 'd',
      default: 'desc',
      description: 'Direction option (`desc` or `asc`) - Default is `desc`'
    },
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Results per page - Default is 30'
    },
    page: {
      type: 'number',
      shortFlag: 'p',
      default: 1,
      description: 'Page number - Default is 1'
    },
    fromTime: {
      type: 'string',
      shortFlag: 'f',
      default: '',
      description: 'From time - as a unix timestamp'
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
      $ ${command} <org slug>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:list

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
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

  const { json, markdown } = cli.flags
  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''
  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      nook: !!defaultOrgSlug,
      test: orgSlug && orgSlug !== '.',
      message: 'Org name as the first argument',
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
      test: apiToken,
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

  await handleListScans({
    direction: String(cli.flags['direction'] || ''),
    from_time: String(cli.flags['fromTime'] || ''),
    orgSlug,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    page: Number(cli.flags['page'] || 1),
    per_page: Number(cli.flags['perPage'] || 30),
    sort: String(cli.flags['sort'] || '')
  })
}
