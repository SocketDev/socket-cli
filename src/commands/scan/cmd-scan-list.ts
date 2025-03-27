import { logger } from '@socketsecurity/registry/lib/logger'

import { handleListScans } from './handle-list-scans'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

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

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''

  const wasBadInput = handleBadInput({
    hide: defaultOrgSlug,
    test: orgSlug,
    message: 'Org name as the first argument',
    pass: 'ok',
    fail: 'missing'
  })
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
    outputKind: cli.flags['json']
      ? 'json'
      : cli.flags['markdown']
        ? 'markdown'
        : 'print',
    page: Number(cli.flags['page'] || 1),
    per_page: Number(cli.flags['perPage'] || 30),
    sort: String(cli.flags['sort'] || '')
  })
}
