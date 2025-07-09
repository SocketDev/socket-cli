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
const TYPE_FILTERS = new Set([
  'anom',
  'c',
  'fp',
  'joke',
  'mal',
  'secret',
  'spy',
  'tp',
  'typo',
  'u',
  'vuln',
])

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
      default: '',
      description: 'Only show threats for a particular ecosystem',
    },
    filter: {
      type: 'string',
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
      default: '',
      description: 'Filter by this package name',
    },
    version: {
      type: 'string',
      default: '',
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
      ${getFlagListOutput(config.flags)}

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

    You can put filters as args instead, we'll try to match the strings with the
    correct filter type but since this would not allow you to search for a package
    called "mal", you can also specify the filters through flags.

    First arg that matches a typo, eco, or version enum is used as such. First arg
    that matches none of them becomes the package name filter. Rest is ignored.

    Note: The version filter is a prefix search, pkg name is a substring search.

    Examples
      $ ${command}
      $ ${command} maven --json
      $ ${command} typo
      $ ${command} npm joke 1.0.0 --perPage=5 --page=2 --direction=asc
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
    eco,
    interactive,
    json,
    markdown,
    org: orgFlag,
    pkg,
    type: typef,
    version,
  } = cli.flags

  let ecoFilter = String(eco || '')
  let versionFilter = String(version || '')
  let typeFilter = String(typef || '')
  let nameFilter = String(pkg || '')

  const argSet = new Set(cli.input)
  cli.input.some(str => {
    if (ECOSYSTEMS.has(str)) {
      ecoFilter = str
      argSet.delete(str)
      return true
    }
  })

  cli.input.some(str => {
    if (/^v?\d+\.\d+\.\d+$/.test(str)) {
      versionFilter = str
      argSet.delete(str)
      return true
    }
  })

  cli.input.some(str => {
    if (TYPE_FILTERS.has(str)) {
      typeFilter = str
      argSet.delete(str)
      return true
    }
  })

  const haves = new Set([ecoFilter, versionFilter, typeFilter])
  cli.input.some(str => {
    if (!haves.has(str)) {
      nameFilter = str
      argSet.delete(str)
      return true
    }
  })

  if (argSet.size) {
    logger.info(
      `Warning: ignoring these excessive args: ${Array.from(argSet).join(', ')}`,
    )
  }

  const hasApiToken = hasDefaultToken()

  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    !!interactive,
    !!dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

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
    pkg: nameFilter,
    version: versionFilter,
  })
}
