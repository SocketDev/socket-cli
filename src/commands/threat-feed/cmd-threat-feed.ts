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
  description: '[beta] Look at the threat feed',
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
    ecoSystem: {
      type: 'string',
      shortFlag: 'e',
      default: '',
      description: 'Only show threats for a particular eco system'
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

    This feature requires an Enterprise Plan with Threat Feed add-on. Please
    contact sales@socket.dev if you would like access to this feature.

    Valid filters:

      - c       Do not filter
      - u       Unreviewed
      - fp      False Positives
      - tp      False Positives and Unreviewed
      - mal     Malware and Possible Malware [default]
      - vuln    Vulnerability
      - anom    Anomaly
      - secret  Secret
      - joke    Joke / Fake
      - spy     Telemetry
      - typo    Typo-squat

    Valid eco systems:

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
    ecoSystem: String(cli.flags['ecoSystem'] || ''),
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
