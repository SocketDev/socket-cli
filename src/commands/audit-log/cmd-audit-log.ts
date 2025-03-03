import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getAuditLog } from './get-audit-log'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

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
  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(
      `
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
    `.trim()
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await getAuditLog({
    orgSlug,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'print',
    page: Number(page || 0),
    perPage: Number(perPage || 0),
    logType: logType.charAt(0).toUpperCase() + logType.slice(1)
  })
}
