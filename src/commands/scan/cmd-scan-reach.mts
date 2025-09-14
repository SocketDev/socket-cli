import path from 'node:path'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanReach } from './handle-scan-reach.mts'
import { reachabilityFlags } from './reachability-flags.mts'
import { suggestTarget } from './suggest_target.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'

import type { MeowFlags } from '../../flags.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'reach'

const description = 'Compute tier 1 reachability'

const hidden = true

const generalFlags: MeowFlags = {
  ...commonFlags,
  ...outputFlags,
  cwd: {
    type: 'string',
    default: '',
    description: 'working directory, defaults to process.cwd()',
  },
  org: {
    type: 'string',
    default: '',
    description:
      'Force override the organization slug, overrides the default org from config',
  },
}

export const cmdScanReach = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...generalFlags,
      ...reachabilityFlags,
    },
    help: command =>
      `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(generalFlags)}

    Reachability Options
      ${getFlagListOutput(reachabilityFlags)}

    Runs the Socket reachability analysis without creating a scan in Socket.
    The output is written to .socket.facts.json in the current working directory.

    Note: Manifest files are uploaded to Socket's backend services because the
    reachability analysis requires creating a Software Bill of Materials (SBOM)
    from these files before the analysis can run.

    Examples
      $ ${command}
      $ ${command} ./proj
      $ ${command} ./proj --reach-ecosystems npm,pypi
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    cwd: cwdOverride,
    interactive = true,
    json,
    markdown,
    org: orgFlag,
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachDisableAnalytics,
    reachSkipCache,
  } = cli.flags as {
    cwd: string
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    reachAnalysisTimeout: number
    reachAnalysisMemoryLimit: number
    reachDisableAnalytics: boolean
    reachSkipCache: boolean
  }

  const dryRun = !!cli.flags['dryRun']

  // Process comma-separated values for isMultiple flags.
  const reachEcosystemsRaw = cmdFlagValueToArray(cli.flags['reachEcosystems'])
  const reachExcludePaths = cmdFlagValueToArray(cli.flags['reachExcludePaths'])

  // Validate ecosystem values.
  const reachEcosystems: PURL_Type[] = []
  const validEcosystems = getEcosystemChoicesForMeow()
  for (const ecosystem of reachEcosystemsRaw) {
    if (!validEcosystems.includes(ecosystem)) {
      throw new Error(
        `Invalid ecosystem: "${ecosystem}". Valid values are: ${joinAnd(validEcosystems)}`,
      )
    }
    reachEcosystems.push(ecosystem as PURL_Type)
  }

  const processCwd = process.cwd()
  const cwd =
    cwdOverride && cwdOverride !== '.' && cwdOverride !== processCwd
      ? path.resolve(processCwd, cwdOverride)
      : processCwd

  // Accept zero or more paths. Default to cwd() if none given.
  let targets = cli.input || [cwd]

  // Use suggestTarget if no targets specified and in interactive mode
  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
  }

  const { 0: orgSlug } = await determineOrgSlug(orgFlag, interactive, dryRun)

  const hasApiToken = hasDefaultApiToken()

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
      test: hasApiToken,
      message: 'This command requires an API token for access',
      fail: 'try `socket login`',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleScanReach({
    cwd,
    orgSlug,
    outputKind,
    targets,
    interactive,
    reachabilityOptions: {
      reachAnalysisTimeout: Number(reachAnalysisTimeout),
      reachAnalysisMemoryLimit: Number(reachAnalysisMemoryLimit),
      reachDisableAnalytics: Boolean(reachDisableAnalytics),
      reachEcosystems,
      reachExcludePaths,
      reachSkipCache: Boolean(reachSkipCache),
    },
  })
}
