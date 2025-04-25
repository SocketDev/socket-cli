import { logger } from '@socketsecurity/registry/lib/logger'

import { handleThreatFeed } from './handle-threat-feed'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { isTestingV1 } from '../../utils/config'
import { determineOrgSlug } from '../../utils/determine-org-slug'
import { getOutputKind } from '../../utils/get-output-kind'
import { checkCommandInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'threat-feed',
  description: '[beta] View the threat feed',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    interactive: {
      type: 'boolean',
      default: true,
      description:
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.'
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config'
    },
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
      description: 'Order asc or desc by the createdAt attribute'
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
      $ ${command}${isTestingV1() ? '' : ' <org slug>'}

    API Token Requirements
      - Quota: 1 unit
      - Permissions: threat-feed:list
      - Special access

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
      $ ${command}${isTestingV1() ? '' : ' FakeOrg'}
      $ ${command}${isTestingV1() ? '' : ' FakeOrg'} --perPage=5 --page=2 --direction=asc --filter=joke
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

  const { dryRun, interactive, json, markdown, org: orgFlag } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    !!interactive,
    !!dryRun
  )

  const apiToken = getDefaultToken()

  const wasBadInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name as the first argument',
      pass: 'ok',
      fail: 'missing'
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
      test: !!apiToken,
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

  await handleThreatFeed({
    direction: String(cli.flags['direction'] || 'desc'),
    ecosystem: String(cli.flags['eco'] || ''),
    filter: String(cli.flags['filter'] || 'mal'),
    outputKind,
    page: String(cli.flags['page'] || '1'),
    perPage: Number(cli.flags['perPage']) || 30
  })
}
