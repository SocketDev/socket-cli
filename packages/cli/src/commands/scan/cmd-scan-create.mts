import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

import { applyScanCreateDefaults } from './cmd-scan-create-defaults.mts'
import {
  computeReachabilityFlagUsage,
  validateReachEcosystems,
  validateScanCreateInput,
} from './cmd-scan-create-checks.mts'
import { resolveScanCreateTargetsAndOrg } from './cmd-scan-create-interactive.mts'
import { validateScanCreateNumericFlags } from './cmd-scan-create-numeric-flags.mts'
import { assertNoNegationPatterns } from './exclude-paths.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { excludePathsFlag, reachabilityFlags } from './reachability-flags.mts'
import { validateReachabilityTarget } from './validate-reachability-target.mts'
import { REQUIREMENTS_TXT } from '../../constants.mts'
import { outputDryRunUpload } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mts'
import { cmdFlagValueToArray } from '../../util/process/cmd.mts'
import { readOrDefaultSocketJsonUp } from '../../util/socket/json.mts'
import { determineOrgSlug } from '../../util/socket/org-slug.mts'
import { hasDefaultApiToken } from '../../util/socket/sdk.mts'
import { socketDashboardLink } from '../../util/terminal/link.mts'

import type { REPORT_LEVEL } from './types.mts'
import type { CliCommandContext } from '../../util/cli/with-subcommands.mts'
import type { PURL_Type } from '../../util/ecosystem/types.mts'

// Flags interface for type safety.
export interface ScanCreateFlags {
  autoManifest?: boolean | undefined
  basics?: boolean | undefined
  branch: string
  commitHash: string
  commitMessage: string
  committers: string
  cwd: string
  defaultBranch: boolean
  makeDefaultBranch: boolean
  interactive: boolean
  json: boolean
  markdown: boolean
  org: string
  pullRequest: number
  reach: boolean
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
  readOnly: boolean
  repo: string
  report?: boolean | undefined
  reportLevel: REPORT_LEVEL
  setAsAlertsPage: boolean
  tmp: boolean
  workspace: string
}

export const CMD_NAME = 'create'

const description = 'Create a new Socket scan and report'

const hidden = false

// Flag schema extracted to keep this file under the 1000-line File-size cap.
import { generalFlags } from './cmd-scan-create-flags.mts'

// Legacy flag names kept working via meow aliases on `makeDefaultBranch`.
// Detected here so we can warn on use and keep the misuse heuristic
// working against both the primary and legacy names.
// --default-branch / --make-default-branch validation helpers extracted
// to keep this file under the 1000-line File-size cap.
import {
  findDefaultBranchValueMisuse,
  hasLegacyDefaultBranchFlag,
  isBareIdentifier,
} from './cmd-scan-create-validation.mts'

export {
  findDefaultBranchValueMisuse,
  hasLegacyDefaultBranchFlag,
  isBareIdentifier,
}

export const cmdScanCreate = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...generalFlags,
      ...excludePathsFlag,
      ...reachabilityFlags,
    }),
    help: (command: string) => `
    Usage
      $ ${command} [options] [TARGET...]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput({ ...generalFlags, ...excludePathsFlag })}

    Reachability Options (when --reach is used)
      ${getFlagListOutput(reachabilityFlags)}

    Uploads the specified dependency manifest files for Go, Gradle, JavaScript,
    Kotlin, Python, and Scala. Files like "package.json" and "${REQUIREMENTS_TXT}".
    If any folder is specified, the ones found in there recursively are uploaded.

    Details on TARGET:

    - Defaults to the current dir (cwd) if none given
    - Multiple targets can be specified
    - If a target is a file, only that file is checked
    - If it is a dir, the dir is scanned for any supported manifest files
    - Dirs MUST be within the current dir (cwd), you can use --cwd to change it
    - Supports globbing such as "**/package.json", "**/${REQUIREMENTS_TXT}", etc.
    - Ignores files specified in your project's ".gitignore"
    - Ignores files specified in your "socket.yml" file's "projectIgnorePaths"
    - Also a sensible set of default ignores from the "ignore-by-default" module

    The --repo and --branch flags tell Socket to associate this Scan with that
    repo/branch. The names will show up on your dashboard on the Socket website.

    Note: on a first scan you probably want to pass --make-default-branch so
          Socket records this branch ("main", "master", etc.) as your repo's
          default branch. Subsequent scans don't need the flag unless you're
          reassigning the default-branch pointer to a different branch.

    The ${socketDashboardLink('/org/YOURORG/alerts', '"alerts page"')} will show
    the results from the last scan designated as the "pending head" on the branch
    configured on Socket to be the "default branch". When creating a scan the
    --set-as-alerts-page flag will default to true to update this. You can prevent
    this by using --no-set-as-alerts-page. This flag is ignored for any branch that
    is not designated as the "default branch". It is disabled when using --tmp.

    You can use \`socket scan setup\` to configure certain repo flag defaults.

    Examples
      $ ${command}
      $ ${command} ./proj --json
      $ ${command} --repo=test-repo --branch=main ./package.json
  `,
  }

  // `--make-default-branch` (and its deprecated alias `--default-branch`)
  // is a boolean flag, so meow/yargs-parser silently drops any value
  // attached to it — the resulting scan is untagged and invisible in the
  // Main/PR dashboard tabs. Catch that shape before meow parses so the
  // user sees an actionable error instead of a mysteriously-mislabelled
  // scan hours later.
  const defaultBranchMisuse = findDefaultBranchValueMisuse(argv)
  if (defaultBranchMisuse) {
    const { form, value } = defaultBranchMisuse
    logger.fail(
      `"${form}" looks like you meant to name the branch "${value}", but --make-default-branch is a boolean flag (no value).\n\n` +
        `To scan "${value}" as the default branch, use --branch for the name and --make-default-branch as a flag:\n` +
        `  socket scan create --branch ${value} --make-default-branch\n\n` +
        `To scan a non-default branch, drop --make-default-branch:\n` +
        `  socket scan create --branch ${value}`,
    )
    process.exitCode = 2
    return
  }

  // `--default-branch` / `--defaultBranch` is kept working via meow's
  // aliases, but nudge callers to migrate so we can eventually retire
  // the legacy name.
  if (hasLegacyDefaultBranchFlag(argv)) {
    logger.warn(
      '--default-branch is deprecated on `socket scan create`; use --make-default-branch instead. The old flag still works for now.',
    )
  }

  const cli = meowOrExit({
    argv,
    config,
    parentName,
    importMeta,
  })

  const {
    commitHash,
    commitMessage,
    committers,
    cwd: cwdOverride,
    defaultBranch: legacyDefaultBranch,
    interactive,
    makeDefaultBranch: makeDefaultBranchFlag,
    json,
    markdown,
    org: orgFlag,
    pullRequest,
    reach,
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
    readOnly,
    reportLevel,
    setAsAlertsPage: pendingHeadFlag,
    tmp,
  } = cli.flags as unknown as ScanCreateFlags

  // Merge the legacy --default-branch flag into the primary. Both are
  // declared as separate boolean flags in the config (see the comment
  // on the `defaultBranch` flag definition above).
  const makeDefaultBranch = makeDefaultBranchFlag || legacyDefaultBranch

  // Validate ecosystem values.
  const reachEcosystemsRaw = cmdFlagValueToArray(cli.flags['reachEcosystems'])
  const reachEcosystems: PURL_Type[] =
    validateReachEcosystems(reachEcosystemsRaw)

  const dryRun = !!cli.flags['dryRun']

  const { basics } = cli.flags as unknown as ScanCreateFlags

  let {
    autoManifest,
    branch: branchName,
    repo: repoName,
    report,
    workspace,
  } = cli.flags as unknown as ScanCreateFlags

  let { 0: orgSlug } = await determineOrgSlug(
    orgFlag || '',
    interactive,
    dryRun,
  )

  const processCwd = process.cwd()
  const cwd =
    cwdOverride && cwdOverride !== '.' && cwdOverride !== processCwd
      ? path.resolve(processCwd, cwdOverride)
      : processCwd

  const sockJson = await readOrDefaultSocketJsonUp(cwd)

  ;({ autoManifest, branchName, repoName, report, workspace } =
    await applyScanCreateDefaults(cwd, sockJson, {
      autoManifest,
      branchName,
      repoName,
      report,
      workspace,
    }))

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const hasApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  const pendingHead = tmp ? false : pendingHeadFlag

  const suggestResult = await resolveScanCreateTargetsAndOrg({
    autoManifest,
    cli,
    cwd,
    dryRun,
    hasApiToken,
    interactive,
    orgSlug,
    outputKind,
    sockJson,
  })
  if (suggestResult.canceled) {
    return
  }
  const targets = suggestResult.targets
  orgSlug = suggestResult.orgSlug

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertNoNegationPatterns(excludePaths)

  const reachExcludePaths = cmdFlagValueToArray(cli.flags['reachExcludePaths'])

  const isUsingAnyReachabilityFlags = computeReachabilityFlagUsage({
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachConcurrency,
    reachDisableAnalytics,
    reachEcosystems,
    reachEnableAnalysisSplitting,
    reachExcludePaths,
    reachLazyMode,
    reachSkipCache,
  })

  // Validate target constraints when --reach is enabled.
  const reachTargetValidation = reach
    ? await validateReachabilityTarget(targets, cwd)
    : {
        isDirectory: false,
        isInsideCwd: false,
        isValid: true,
        targetExists: false,
      }

  const wasValidInput = validateScanCreateInput({
    branchName,
    hasApiToken,
    isUsingAnyReachabilityFlags,
    json,
    makeDefaultBranch,
    markdown,
    orgSlug,
    outputKind,
    pendingHead,
    reach,
    reachTargetValidation,
    targets,
  })
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    const details: Record<string, unknown> = {
      organization: orgSlug,
      targets: targets.join(', '),
    }
    if (repoName) {
      details['repository'] = repoName
    }
    if (branchName) {
      details['branch'] = branchName
    }
    if (reach) {
      details['reachabilityAnalysis'] = 'enabled'
      if (reachEcosystems.length > 0) {
        details['ecosystems'] = reachEcosystems.join(', ')
      }
    }
    outputDryRunUpload('scan', details)
    return
  }

  // Validate numeric flag conversions.
  const {
    validatedPullRequest,
    validatedReachAnalysisMemoryLimit,
    validatedReachAnalysisTimeout,
    validatedReachConcurrency,
  } = validateScanCreateNumericFlags({
    pullRequest,
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachConcurrency,
  })

  await handleCreateNewScan({
    autoManifest: autoManifest,
    basics: Boolean(basics),
    branchName: branchName,
    commitHash: (commitHash && commitHash) || '',
    commitMessage: (commitMessage && commitMessage) || '',
    committers: (committers && committers) || '',
    cwd,
    defaultBranch: makeDefaultBranch,
    interactive: interactive,
    orgSlug,
    outputKind,
    pendingHead: pendingHead,
    pullRequest: validatedPullRequest,
    reach: {
      excludePaths,
      runReachabilityAnalysis: reach,
      reachAnalysisMemoryLimit: validatedReachAnalysisMemoryLimit,
      reachAnalysisTimeout: validatedReachAnalysisTimeout,
      reachConcurrency: validatedReachConcurrency,
      reachDebug: reachDebug,
      reachDetailedAnalysisLogFile: reachDetailedAnalysisLogFile,
      reachDisableAnalytics: reachDisableAnalytics,
      reachDisableExternalToolChecks: reachDisableExternalToolChecks,
      reachEnableAnalysisSplitting: reachEnableAnalysisSplitting,
      reachEcosystems,
      reachExcludePaths,
      reachLazyMode: reachLazyMode,
      reachMinSeverity: reachMinSeverity,
      reachSkipCache: reachSkipCache,
      reachUseOnlyPregeneratedSboms: reachUseOnlyPregeneratedSboms,
      reachUseUnreachableFromPrecomputation:
        reachUseUnreachableFromPrecomputation,
      reachVersion: reachVersion || undefined,
    },
    readOnly: readOnly,
    repoName,
    report,
    reportLevel,
    targets,
    tmp: tmp,
    workspace: (workspace && workspace) || '',
  })
}
