import meowOrDie from 'meow'
import colors from 'yoctocolors-cjs'

import { getAuditLog } from './get-audit-log.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

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
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} <org slug>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} FakeOrg
  `
}

export const cmdAuditLog = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrDie(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  const type = String(cli.flags['type'] || '')
  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
    - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
    `)
    config.help(parentName, config)
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await getAuditLog({
    apiToken,
    orgSlug,
    outputJson: Boolean(cli.flags['json']),
    outputMarkdown: Boolean(cli.flags['markdown']),
    page: Number(cli.flags['page'] || 0),
    perPage: Number(cli.flags['perPage'] || 0),
    type: type.charAt(0).toUpperCase() + type.slice(1)
  })
}
