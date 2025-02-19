import meowOrExit from 'meow'

import { getThreatFeed } from './get-threat-feed.ts'
import { commonFlags, outputFlags } from '../../flags'
import { AuthError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

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
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName}
      $ ${parentName} ${config.commandName} --perPage=5 --page=2 --direction=asc --filter=joke
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
  const cli = meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

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
