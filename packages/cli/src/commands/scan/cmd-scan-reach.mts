import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib/arrays'

import { handleScanReach } from './handle-scan-reach.mts'
import { reachabilityFlags } from './reachability-flags.mts'
import { suggestTarget } from './suggest_target.mts'
import { validateReachabilityTarget } from './validate-reachability-target.mts'
import { outputDryRunExecute } from '../../utils/dry-run/output.mts'
import { InputError } from '../../utils/error/errors.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mts'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem/types.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mts'
import { cmdFlagValueToArray } from '../../utils/process/cmd.mts'
import { determineOrgSlug } from '../../utils/socket/org-slug.mts'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mts'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type { MeowFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mts'
import type { PURL_Type } from '../../utils/ecosystem/types.mts'

// Flags interface for type safety.
interface ScanReachFlags {
  cwd: string
  interactive: boolean
  json: boolean
  markdown: boolean
  org: string
  output: string
  reachAnalysisMemoryLimit: number
  reachAnalysisTimeout: number
  reachConcurrency: number
  reachDebug: boolean
  reachDetailedAnalysisLogFile: boolean
  reachDisableAnalytics: boolean
  reachDisableExternalToolChecks: boolean
  reachEnableAnalysisSplitting: boolean
  reachLazyMode: boolean
  reachMinSeverity: string
  reachSkipCache: boolean
  reachUseOnlyPregeneratedSboms: boolean
  reachUseUnreachableFromPrecomputation: boolean
  reachVersion: string
}

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
    reachConcurrency,
    reachDebug,
    reachDetailedAnalysisLogFile,
    reachDisableAnalytics,
    reachDisableExternalToolChecks,
    reachEnableAnalysisSplitting,
    reachLazyMode,
    reachMinSeverity,
    reachSkipCache,
    reachUseOnlyPregeneratedSboms,
    reachUseUnreachableFromPrecomputation,
    reachVersion,
  } = cli.flags as unknown as ScanReachFlags

  const dryRun = !!cli.flags['dryRun']

  // Process comma-separated values for isMultiple flags.
  const reachEcosystemsRaw = cmdFlagValueToArray(cli.flags['reachEcosystems'])
  const reachExcludePaths = cmdFlagValueToArray(cli.flags['reachExcludePaths'])

  // Validate ecosystem values.
  const reachEcosystems: PURL_Type[] = []
  const validEcosystems = getEcosystemChoicesForMeow()
  for (const ecosystem of reachEcosystemsRaw) {
    if (!validEcosystems.includes(ecosystem)) {
      throw new InputError(
        `--reach-ecosystems must be one of: ${joinAnd(validEcosystems)} (saw: "${ecosystem}"); pass a supported ecosystem like --reach-ecosystems=${validEcosystems[0]}`,
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
  let targets = cli.input.length ? [...cli.input] : [cwd]

  // Use suggestTarget if no targets specified and in interactive mode
  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
  }

  const { 0: orgSlug } = await determineOrgSlug(orgFlag, interactive, dryRun)

  const hasApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  // Validate target constraints for reachability analysis.
  const targetValidation = await validateReachabilityTarget(targets, cwd)

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
    {
      nook: true,
      test: targetValidation.isValid,
      message: 'Reachability analysis requires exactly one target directory',
      fail: 'provide exactly one directory path',
    },
    {
      nook: true,
      test: targetValidation.isDirectory,
      message: 'Reachability analysis target must be a directory',
      fail: 'provide a directory path, not a file',
    },
    {
      nook: true,
      test: targetValidation.targetExists,
      message: 'Target directory must exist',
      fail: 'provide an existing directory path',
    },
    {
      nook: true,
      test: targetValidation.isInsideCwd,
      message: 'Target directory must be inside the current working directory',
      fail: 'provide a path inside the working directory',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    const args: string[] = []
    if (targets[0]) {
      args.push('--target', targets[0])
    }
    if (orgSlug) {
      args.push('--org', orgSlug)
    }
    if (reachEcosystems.length > 0) {
      args.push('--ecosystems', reachEcosystems.join(','))
    }
    outputDryRunExecute('coana', args, 'reachability analysis')
    return
  }

  // Validate numeric flag conversions.
  const validatedReachAnalysisMemoryLimit = Number(reachAnalysisMemoryLimit)
  if (
    reachAnalysisMemoryLimit !== undefined &&
    Number.isNaN(validatedReachAnalysisMemoryLimit)
  ) {
    throw new InputError(
      `--reach-analysis-memory-limit must be a number of megabytes (saw: "${reachAnalysisMemoryLimit}"); pass an integer like --reach-analysis-memory-limit=4096`,
    )
  }

  const validatedReachAnalysisTimeout = Number(reachAnalysisTimeout)
  if (
    reachAnalysisTimeout !== undefined &&
    Number.isNaN(validatedReachAnalysisTimeout)
  ) {
    throw new InputError(
      `--reach-analysis-timeout must be a number of seconds (saw: "${reachAnalysisTimeout}"); pass an integer like --reach-analysis-timeout=300`,
    )
  }

  const validatedReachConcurrency = Number(reachConcurrency)
  if (
    reachConcurrency !== undefined &&
    (Number.isNaN(validatedReachConcurrency) ||
      !Number.isInteger(validatedReachConcurrency) ||
      validatedReachConcurrency <= 0)
  ) {
    throw new InputError(
      `--reach-concurrency must be a positive integer (saw: "${reachConcurrency}"); pass a number like --reach-concurrency=4`,
    )
  }

  await handleScanReach({
    cwd,
    interactive,
    orgSlug,
    outputKind,
    outputPath: outputPath || '',
    targets,
    reachabilityOptions: {
      reachAnalysisMemoryLimit: validatedReachAnalysisMemoryLimit,
      reachAnalysisTimeout: validatedReachAnalysisTimeout,
      reachConcurrency: validatedReachConcurrency,
      reachDebug: Boolean(reachDebug),
      reachDetailedAnalysisLogFile: Boolean(reachDetailedAnalysisLogFile),
      reachDisableAnalytics: Boolean(reachDisableAnalytics),
      reachDisableExternalToolChecks: Boolean(reachDisableExternalToolChecks),
      reachEnableAnalysisSplitting: Boolean(reachEnableAnalysisSplitting),
      reachEcosystems,
      reachExcludePaths,
      reachLazyMode: Boolean(reachLazyMode),
      reachMinSeverity: String(reachMinSeverity),
      reachSkipCache: Boolean(reachSkipCache),
      reachUseOnlyPregeneratedSboms: Boolean(reachUseOnlyPregeneratedSboms),
      reachUseUnreachableFromPrecomputation: Boolean(
        reachUseUnreachableFromPrecomputation,
      ),
      reachVersion: reachVersion || undefined,
    },
  })
}
