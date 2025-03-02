import { logger } from '@socketsecurity/registry/lib/logger'

import { getThreatFeed } from './get-threat-feed'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'threat-feed',
  description: 'Look up the threat feed',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Number of items per page'
    },
    page: {
      type: 'string',
      shortFlag: 'p',
      default: '1',
      description: 'Page token'
    },
    direction: {
      type: 'string',
      shortFlag: 'd',
      default: 'desc',
      description: 'Order asc or desc by the createdAt attribute.'
    },
    filter: {
      type: 'string',
      shortFlag: 'f',
      default: 'mal',
      description: 'Filter what type of threats to return'
    }
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}
      $ ${command} --perPage=5 --page=2 --direction=asc --filter=joke
  `
}

export const cmdThreatFeed = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: ReadonlyArray<string>,
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await getThreatFeed({
    apiToken,
    direction: String(cli.flags['direction'] || 'desc'),
    filter: String(cli.flags['filter'] || 'mal'),
    outputJson: Boolean(cli.flags['json']),
    page: String(cli.flags['filter'] || '1'),
    perPage: Number(cli.flags['per_page'] || 0)
  })
}
