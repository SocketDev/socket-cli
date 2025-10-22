import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib/arrays'
import { logger } from '@socketsecurity/lib/logger'

import { handleScanReach } from './handle-scan-reach.mts'
import { reachabilityFlags } from './reachability-flags.mts'
import { suggestTarget } from './suggest_target.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem/ecosystem.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { cmdFlagValueToArray } from '../../utils/process/cmd.mts'
import { determineOrgSlug } from '../../utils/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type { MeowFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import type { PURL_Type } from '../../utils/ecosystem/ecosystem.mjs'

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
  output: {
    type: 'string',
    default: '',
    description:
      'Path to write the reachability report to (must end with .json). Defaults to .socket.facts.json in the current working directory.',
    shortFlag: 'o',
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
    The output is written to .socket.facts.json in the current working directory
    unless the --output flag is specified.

    Note: Manifest files are uploaded to Socket's backend services because the
    reachability analysis requires creating a Software Bill of Materials (SBOM)
    from these files before the analysis can run.

    Examples
      $ ${command}
      $ ${command} ./proj
      $ ${command} ./proj --reach-ecosystems npm,pypi
      $ ${command} --output custom-report.json
      $ ${command} ./proj --output ./reports/analysis.json
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
    output: outputPath,
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachDisableAnalytics,
    reachSkipCache,
  } = cli.flags as unknown as {
    cwd: string
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    output: string
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
  let targets: string[] = cli.input ? [...cli.input] : [cwd]

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
    {
      nook: true,
      test: !outputPath || outputPath.endsWith('.json'),
      message: 'The --output path must end with .json',
      fail: 'use a path ending with .json',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handleScanReach({
    cwd,
    interactive,
    orgSlug,
    outputKind,
    outputPath: outputPath || '',
    reachabilityOptions: {
      reachAnalysisTimeout: Number(reachAnalysisTimeout),
      reachAnalysisMemoryLimit: Number(reachAnalysisMemoryLimit),
      reachDisableAnalytics: Boolean(reachDisableAnalytics),
      reachEcosystems,
      reachExcludePaths,
      reachSkipCache: Boolean(reachSkipCache),
    },
    targets,
  })
}
