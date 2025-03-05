import { logger } from '@socketsecurity/registry/lib/logger'

import { getThreatFeed } from './get-threat-feed'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'threat-feed',
  description: '[beta] View the threat feed',
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
    eco: {
      type: 'string',
      shortFlag: 'e',
      default: '',
      description: 'Only show threats for a particular ecosystem'
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

    This feature requires a Threat Feed license. Please contact
    sales@socket.dev if you are interested in purchasing this access.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Valid filters:

      - anom    Anomaly
      - c       Do not filter
      - fp      False Positives
      - joke    Joke / Fake
      - mal     Malware and Possible Malware [default]
      - secret  Secrets
      - spy     Telemetry
      - tp      False Positives and Unreviewed
      - typo    Typo-squat
      - u       Unreviewed
      - vuln    Vulnerability

    Valid ecosystems:

      - gem
      - golang
      - maven
      - npm
      - nuget
      - pypi

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
  argv: readonly string[],
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

  await getThreatFeed({
    direction: String(cli.flags['direction'] || 'desc'),
    ecosystem: String(cli.flags['eco'] || ''),
    filter: String(cli.flags['filter'] || 'mal'),
    outputKind: cli.flags['json']
      ? 'json'
      : cli.flags['markdown']
        ? 'markdown'
        : 'print',
    page: String(cli.flags['page'] || '1'),
    perPage: Number(cli.flags['perPage']) || 30
  })
}
