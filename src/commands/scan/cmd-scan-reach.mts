import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleScanReach } from './handle-scan-reach.mts'
import { reachabilityFlags } from './reachability-flags.mts'
import { suggestTarget } from './suggest_target.mts'
import constants from '../../constants.mts'
import { type MeowFlags, commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const generalFlags: MeowFlags = {
  ...commonFlags,
  ...outputFlags,
  cwd: {
    type: 'string',
    description: 'working directory, defaults to process.cwd()',
  },
  org: {
    type: 'string',
    description:
      'Force override the organization slug, overrides the default org from config',
  },
}

const config: CliCommandConfig = {
  commandName: 'reach',
  description: 'Compute tier 1 reachability',
  hidden: true,
  flags: {
    ...generalFlags,
    ...reachabilityFlags,
  },
  help: command =>
    `
    Usage
      $ ${command} [options] [CWD=.]

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

export const cmdScanReach = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
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
    cwd: cwdOverride,
    dryRun = false,
    interactive = true,
    json,
    markdown,
    org: orgFlag,
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachContinueOnFailingProjects,
    reachDisableAnalytics,
  } = cli.flags as {
    cwd: string
    dryRun: boolean
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    reachAnalysisTimeout?: number
    reachAnalysisMemoryLimit?: number
    reachContinueOnFailingProjects: boolean
    reachDisableAnalytics: boolean
  }

  // Process comma-separated values for isMultiple flags.
  const reachEcosystemsRaw = cmdFlagValueToArray(cli.flags['reachEcosystems'])
  const reachExcludePaths = cmdFlagValueToArray(cli.flags['reachExcludePaths'])

  // Validate ecosystem values.
  const reachEcosystems: PURL_Type[] = []
  const validEcosystems = getEcosystemChoicesForMeow()
  for (const ecosystem of reachEcosystemsRaw) {
    if (!validEcosystems.includes(ecosystem)) {
      throw new Error(
        `Invalid ecosystem: "${ecosystem}". Valid values are: ${validEcosystems.join(', ')}`,
      )
    }
    reachEcosystems.push(ecosystem as PURL_Type)
  }

  const outputKind = getOutputKind(json, markdown)

  const cwd =
    cwdOverride && cwdOverride !== 'process.cwd()'
      ? path.resolve(process.cwd(), String(cwdOverride))
      : process.cwd()

  // Accept zero or more paths. Default to cwd() if none given.
  let targets = cli.input || [cwd]

  // Use suggestTarget if no targets specified and in interactive mode
  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
  }

  // Determine org slug
  const [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const hasApiToken = hasDefaultToken()

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
      fail: 'missing (try `socket login`)',
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
    orgSlug,
    outputKind,
    targets,
    interactive,
    reachabilityOptions: {
      reachContinueOnFailingProjects: Boolean(reachContinueOnFailingProjects),
      reachDisableAnalytics: Boolean(reachDisableAnalytics),
      reachAnalysisTimeout: Number(reachAnalysisTimeout),
      reachAnalysisMemoryLimit: Number(reachAnalysisMemoryLimit),
      reachEcosystems,
      reachExcludePaths,
    },
  })
}
