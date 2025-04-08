import { logger } from '@socketsecurity/registry/lib/logger'

import { handleAuditLog } from './handle-audit-log'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'audit-log',
  description: 'Look up the audit log for an organization',
  hidden: false,
  flags: {
    type: {
      type: 'string',
      shortFlag: 't',
      default: '',
      description: 'Type of log event'
    },
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Results per page - default is 30'
    },
    page: {
      type: 'number',
      shortFlag: 'p',
      default: 1,
      description: 'Page number - default is 1'
    },
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <org slug>

    API Token Requirements
      - Quota: 1 unit
      - Permissions: audit-log:list

    This feature requires an Enterprise Plan. To learn more about getting access
    to this feature and many more, please visit https://socket.dev/pricing

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} FakeOrg
  `
}

export const cmdAuditLog = {
  description: config.description,
  hidden: config.hidden,
  run
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

  const { json, markdown, page, perPage, type } = cli.flags
  const logType = String(type || '')

  const defaultOrgSlug = getConfigValue('defaultOrg')
  const orgSlug = defaultOrgSlug || cli.input[0] || ''

  const apiToken = getDefaultToken()

  const wasBadInput = handleBadInput(
    {
      test: !!orgSlug,
      message: 'Org name should be the first arg',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: !!apiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token'
    },
    {
      nook: true,
      test: !json || !markdown,
      message:
        'The `--json` and `--markdown` flags can not be used at the same time',
      pass: 'ok',
      fail: 'bad'
    }
  )
  if (wasBadInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleAuditLog({
    orgSlug,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    page: Number(page || 0),
    perPage: Number(perPage || 0),
    logType: logType.charAt(0).toUpperCase() + logType.slice(1)
  })
}
