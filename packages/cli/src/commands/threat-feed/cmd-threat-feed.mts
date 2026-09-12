import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { NPM } from '@socketsecurity/lib-stable/constants/package-managers'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { handleThreatFeed } from './handle-threat-feed.mts'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { InputError } from '../../util/error/errors.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags, stringFlagValue } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { determineOrgSlug } from '../../util/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { mailtoLink } from '../../util/terminal/link.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'
import type { OutputKind } from '../../types.mts'

const logger = getDefaultLogger()

export const CMD_NAME = 'threat-feed'

// alphabetical by ecosystem name; NPM constant sits between 'maven' and 'nuget'
// which would be its sort position if inlined.
// oxlint-disable-next-line socket/sort-set-args -- no enforced literal order
const ECOSYSTEMS = new Set(['gem', 'golang', 'maven', NPM, 'nuget', 'pypi'])

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

const description = '[Beta] View the threat-feed'

const hidden = false

export const cmdThreatFeed = {
  description,
  hidden,
  run,
}

export interface ThreatFeedFilters {
  eco: string
  name: string
  remaining: string[]
  type: string
  version: string
}

export interface ThreatFeedExecutionConfig extends Omit<
  ThreatFeedFilters,
  'remaining'
> {
  direction: string
  dryRun: boolean
  orgSlug: string
  outputKind: OutputKind
  page: string
  perPage: number | string
}

export async function executeThreatFeed(
  config: ThreatFeedExecutionConfig,
): Promise<void> {
  const cfg = { __proto__: null, ...config } as typeof config
  const perPage = Number(cfg.perPage) || 30
  if (cfg.dryRun) {
    outputDryRunFetch('threat feed data', {
      organization: cfg.orgSlug,
      ecosystem: cfg.eco || 'all',
      type: cfg.type || 'mal (default)',
      package: cfg.name || undefined,
      version: cfg.version || undefined,
      perPage,
      page: cfg.page || '1',
      direction: cfg.direction || 'desc',
    })
    return
  }
  if (Number.isNaN(perPage) || perPage < 1) {
    throw new InputError(
      `--per-page must be a positive integer (saw: "${cfg.perPage}"); pass a number like --per-page=30`,
    )
  }
  await handleThreatFeed({
    direction: cfg.direction || 'desc',
    ecosystem: cfg.eco,
    filter: cfg.type,
    outputKind: cfg.outputKind,
    orgSlug: cfg.orgSlug,
    page: cfg.page || '1',
    perPage,
    pkg: cfg.name,
    version: cfg.version,
  })
}

export function parseThreatFeedFilters(
  input: readonly string[],
  config: { eco: string; name: string; type: string; version: string },
): ThreatFeedFilters {
  const cfg = { __proto__: null, ...config } as typeof config
  let eco = cfg.eco
  let name = cfg.name
  let type = cfg.type
  let version = cfg.version
  const remaining = new Set(input)
  input.some(value => {
    if (ECOSYSTEMS.has(value)) {
      eco = value
      remaining.delete(value)
      return true
    }
    return false
  })
  input.some(value => {
    if (/^v?\d+\.\d+\.\d+$/.test(value)) {
      version = value
      remaining.delete(value)
      return true
    }
    return false
  })
  input.some(value => {
    if (TYPE_FILTERS.has(value)) {
      type = value
      remaining.delete(value)
      return true
    }
    return false
  })
  const assigned = new Set([eco, type, version])
  input.some(value => {
    if (!assigned.has(value)) {
      name = value
      remaining.delete(value)
      return true
    }
    return false
  })
  return {
    __proto__: null,
    eco,
    name,
    remaining: Array.from(remaining),
    type,
    version,
  }
}

export async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
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
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [ECOSYSTEM] [TYPE_FILTER]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}
      - Special access

    This feature requires a Threat Feed license. Please contact
    ${mailtoLink('sales@socket.dev')} if you are interested in purchasing this access.

    Options
      ${getFlagListOutput(helpConfig.flags)}

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
      $ ${command} npm joke 1.0.0 --per-page=5 --page=2 --direction=asc
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    eco,
    json,
    markdown,
    org: orgFlag,
    pkg,
    type: typef,
    version,
  } = cli.flags

  const dryRun = cli.flags['dryRun']

  const interactive = cli.flags['interactive']

  const filters = parseThreatFeedFilters(cli.input, {
    eco: eco || '',
    name: pkg || '',
    type: stringFlagValue(typef),
    version: version || '',
  })
  const {
    eco: ecoFilter,
    name: nameFilter,
    remaining,
    type: typeFilter,
    version: versionFilter,
  } = filters
  if (remaining.length) {
    logger.info(`Warning: ignoring these excessive args: ${joinAnd(remaining)}`)
  }

  const hasApiToken = hasDefaultApiToken()

  const { 0: orgSlug } = await determineOrgSlug(
    orgFlag || '',
    interactive,
    dryRun,
  )

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
  )
  if (!wasValidInput) {
    return
  }

  await executeThreatFeed({
    direction: cli.flags['direction'] || 'desc',
    dryRun,
    eco: ecoFilter,
    name: nameFilter,
    orgSlug,
    outputKind,
    page: cli.flags['page'] || '1',
    perPage: cli.flags['perPage'],
    remaining,
    type: typeFilter,
    version: versionFilter,
  })
}
