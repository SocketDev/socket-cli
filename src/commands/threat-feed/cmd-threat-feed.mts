import { logger } from '@socketsecurity/registry/lib/logger'

import { handleThreatFeed } from './handle-threat-feed.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const ECOSYSTEMS = new Set(['gem', 'golang', 'maven', 'npm', 'nuget', 'pypi'])

const config: CliCommandConfig = {
  commandName: 'threat-feed',
  description: '[beta] View the threat feed',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    direction: {
      type: 'string',
      default: 'desc',
      description: 'Order asc or desc by the createdAt attribute',
    },
    eco: {
      type: 'string',
      shortFlag: 'e',
      default: '',
      description: 'Only show threats for a particular ecosystem',
    },
    filter: {
      type: 'string',
      shortFlag: 'f',
      default: 'mal',
      description: 'Filter what type of threats to return',
    },
    interactive: {
      type: 'boolean',
      default: true,
      description:
        'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config',
    },
    page: {
      type: 'string',
      shortFlag: 'p',
      default: '1',
      description: 'Page token',
    },
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Number of items per page',
    },
    pkg: {
      type: 'string',
      description: 'Filter by this package name',
    },
    version: {
      type: 'string',
      description: 'Filter by this package version',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [ECOSYSTEM] [TYPE_FILTER]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: threat-feed:list
      - Special access

    This feature requires a Threat Feed license. Please contact
    sales@socket.dev if you are interested in purchasing this access.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Valid ecosystems:

      - gem
      - golang
      - maven
      - npm
      - nuget
      - pypi

    Valid type filters:

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

    Note: if you filter by package name or version, it will do so for anything
          unless you also filter by that ecosystem and/or package name. When in
          doubt, look at the threat-feed and see the names in the name/version
          column. That's what you want to search for.

    Examples
      $ ${command}
      $ ${command} maven --json
      $ ${command} typo
      $ ${command} npm joke --perPage=5 --page=2 --direction=asc
  `,
}

export const cmdThreatFeed = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    dryRun,
    interactive,
    json,
    markdown,
    org: orgFlag,
    pkg,
    version,
  } = cli.flags
  const outputKind = getOutputKind(json, markdown)
  const [filter1 = '', filter2 = ''] = cli.input
  const ecoFilter = ECOSYSTEMS.has(filter1) ? filter1 : ''
  const typeFilter = (ecoFilter ? filter2 : filter1) || ''

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
    !!dryRun,
  )

  const hasApiToken = hasDefaultToken()

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      pass: 'ok',
      fail: 'missing',
    },
    {
      nook: true,
      test: !!typeFilter || !filter2,
      message:
        'Second arg should only be given with first arg being a valid ecosystem',
      pass: 'ok',
      fail: 'first arg was not ecosystem and second arg received too',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message:
        'You need to be logged in to use this command. See `socket login`.',
      pass: 'ok',
      fail: 'missing API token',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleThreatFeed({
    direction: String(cli.flags['direction'] || 'desc'),
    ecosystem: ecoFilter,
    filter: typeFilter,
    outputKind,
    orgSlug,
    page: String(cli.flags['page'] || '1'),
    perPage: Number(cli.flags['perPage']) || 30,
    pkg: String(pkg || ''),
    version: String(version || ''),
  })
}
