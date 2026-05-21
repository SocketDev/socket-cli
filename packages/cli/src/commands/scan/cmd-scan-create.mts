/* max-file-lines: legitimate — tracks one cohesive module domain; splitting would scatter tightly coupled helpers. */
import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

import { assertNoNegationPatterns } from './exclude-paths.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { excludePathsFlag, reachabilityFlags } from './reachability-flags.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import { suggestTarget } from './suggest_target.mts'
import { validateReachabilityTarget } from './validate-reachability-target.mts'
import { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
import { outputDryRunUpload } from '../../util/dry-run/output.mts'
import { InputError } from '../../util/error/errors.mts'
import { defineFlags } from '../../meow.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mts'
import { getEcosystemChoicesForMeow } from '../../util/ecosystem/types.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../util/git/operations.mts'
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
import { checkCommandInput } from '../../util/validation/check-input.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'

import type { REPORT_LEVEL } from './types.mts'
import type { CliCommandContext } from '../../util/cli/with-subcommands.mts'
import type { PURL_Type } from '../../util/ecosystem/types.mts'

// Flags interface for type safety.
interface ScanCreateFlags {
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
    interactive = true,
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
  const reachEcosystems: PURL_Type[] = []
  const reachEcosystemsRaw = cmdFlagValueToArray(cli.flags['reachEcosystems'])
  const validEcosystems = getEcosystemChoicesForMeow()
  for (let i = 0, { length } = reachEcosystemsRaw; i < length; i += 1) {
    const ecosystem = reachEcosystemsRaw[i]!
    if (!validEcosystems.includes(ecosystem)) {
      throw new InputError(
        `--reach-ecosystems must be one of: ${joinAnd(validEcosystems)} (saw: "${ecosystem}"); pass a supported ecosystem like --reach-ecosystems=${validEcosystems[0]}`,
      )
    }
    reachEcosystems.push(ecosystem as PURL_Type)
  }

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
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const processCwd = process.cwd()
  const cwd =
    cwdOverride && cwdOverride !== '.' && cwdOverride !== processCwd
      ? path.resolve(processCwd, cwdOverride)
      : processCwd

  const sockJson = await readOrDefaultSocketJsonUp(cwd)

  // Note: This needs meow booleanDefault=undefined.
  if (typeof autoManifest !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.autoManifest !== undefined) {
      autoManifest = sockJson.defaults.scan.create.autoManifest
      logger.info(
        `Using default --auto-manifest from ${SOCKET_JSON}:`,
        autoManifest,
      )
    } else {
      autoManifest = false
    }
  }
  if (!branchName) {
    if (sockJson.defaults?.scan?.create?.branch) {
      branchName = sockJson.defaults.scan.create.branch
      logger.info(`Using default --branch from ${SOCKET_JSON}:`, branchName)
    } else {
      branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
    }
  }
  if (!repoName) {
    if (sockJson.defaults?.scan?.create?.repo) {
      repoName = sockJson.defaults.scan.create.repo
      logger.info(`Using default --repo from ${SOCKET_JSON}:`, repoName)
    } else {
      repoName = await getRepoName(cwd)
    }
  }
  if (!workspace && sockJson.defaults?.scan?.create?.workspace) {
    workspace = sockJson.defaults.scan.create.workspace
    logger.info(`Using default --workspace from ${SOCKET_JSON}:`, workspace)
  }
  if (typeof report !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.report !== undefined) {
      report = sockJson.defaults.scan.create.report
      logger.info(`Using default --report from ${SOCKET_JSON}:`, report)
    } else {
      report = false
    }
  }

  // If we updated any inputs then we should print the command line to repeat
  // the command without requiring user input, as a suggestion.
  let updatedInput = false

  // Accept zero or more paths. Default to cwd() if none given.
  let targets = cli.input.length ? [...cli.input] : [cwd]

  /* c8 ignore start - defensive: targets always has at least [cwd] from the line above */
  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
    updatedInput = true
  }
  /* c8 ignore stop */

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const hasApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  const pendingHead = tmp ? false : pendingHeadFlag

  // If the current cwd is unknown and is used as a repo slug anyways, we will
  // first need to register the slug before we can use it.
  // Only do suggestions with an apiToken and when not in dryRun mode
  if (hasApiToken && !dryRun && interactive) {
    if (!orgSlug) {
      const suggestion = await suggestOrgSlug()
      if (suggestion === undefined) {
        await outputCreateNewScan(
          {
            ok: false,
            message: 'Canceled by user',
            cause: 'Org selector was canceled by user',
          },
          {
            interactive: false,
            outputKind,
          },
        )
        return
      }
      if (suggestion) {
        orgSlug = suggestion
      }
      updatedInput = true
    }
  }

  const detected = await detectManifestActions(sockJson, cwd)
  if (detected.count > 0 && !autoManifest) {
    logger.info(
      `Detected ${detected.count} manifest targets we could try to generate. Please set the --auto-manifest flag if you want to include languages covered by \`socket manifest auto\` in the Scan.`,
    )
  }

  if (updatedInput && orgSlug && targets.length) {
    logger.info(
      'Note: You can invoke this command next time to skip the interactive questions:',
    )
    logger.error('```')
    logger.error(
      `    socket scan create [other flags...] ${orgSlug} ${targets.join(' ')}`,
    )
    logger.error('```')
    logger.error('')
    logger.info(
      `You can also run \`socket scan setup\` to persist these flag defaults to a ${SOCKET_JSON} file.`,
    )
    logger.error('')
  }

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertNoNegationPatterns(excludePaths)

  const reachExcludePaths = cmdFlagValueToArray(cli.flags['reachExcludePaths'])

  // Validation helpers for better readability.
  const hasReachEcosystems = reachEcosystems.length > 0

  const hasReachExcludePaths = reachExcludePaths.length > 0

  const isUsingNonDefaultMemoryLimit =
    reachAnalysisMemoryLimit !==
    reachabilityFlags['reachAnalysisMemoryLimit']?.default

  const isUsingNonDefaultTimeout =
    reachAnalysisTimeout !== reachabilityFlags['reachAnalysisTimeout']?.default

  const isUsingNonDefaultConcurrency =
    reachConcurrency !== reachabilityFlags['reachConcurrency']?.default

  const isUsingNonDefaultAnalytics =
    reachDisableAnalytics !==
    reachabilityFlags['reachDisableAnalytics']?.default

  const isUsingAnyReachabilityFlags =
    hasReachEcosystems ||
    hasReachExcludePaths ||
    isUsingNonDefaultAnalytics ||
    isUsingNonDefaultConcurrency ||
    isUsingNonDefaultMemoryLimit ||
    isUsingNonDefaultTimeout ||
    reachEnableAnalysisSplitting ||
    reachLazyMode ||
    reachSkipCache

  // Validate target constraints when --reach is enabled.
  const reachTargetValidation = reach
    ? await validateReachabilityTarget(targets, cwd)
    : {
        isDirectory: false,
        isInsideCwd: false,
        isValid: true,
        targetExists: false,
      }

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !!orgSlug,
      message: 'Org name by default setting, --org, or auto-discovered',
      fail: 'missing',
    },
    {
      test: !!targets.length,
      message: 'At least one TARGET (e.g. `.` or `./package.json`)',
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
    {
      nook: true,
      test: !makeDefaultBranch || !!branchName,
      message: 'When --make-default-branch is set, --branch is mandatory',
      fail: 'missing branch name',
    },
    {
      nook: true,
      test: !pendingHead || !!branchName,
      message: 'When --pending-head is set, --branch is mandatory',
      fail: 'missing branch name',
    },
    {
      nook: true,
      test: reach || !isUsingAnyReachabilityFlags,
      message: 'Reachability analysis flags require --reach to be enabled',
      fail: 'add --reach flag to use --reach-* options',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.isValid,
      message:
        'Reachability analysis requires exactly one target directory when --reach is enabled',
      fail: 'provide exactly one directory path',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.isDirectory,
      message:
        'Reachability analysis target must be a directory when --reach is enabled',
      fail: 'provide a directory path, not a file',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.targetExists,
      message: 'Target directory must exist when --reach is enabled',
      fail: 'provide an existing directory path',
    },
    {
      nook: true,
      test: !reach || reachTargetValidation.isInsideCwd,
      message:
        'Target directory must be inside the current working directory when --reach is enabled',
      fail: 'provide a path inside the working directory',
    },
  )
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
  const validatedPullRequest = Number(pullRequest)
  if (
    pullRequest !== undefined &&
    (Number.isNaN(validatedPullRequest) ||
      !Number.isInteger(validatedPullRequest) ||
      validatedPullRequest < 0)
  ) {
    throw new InputError(
      `--pull-request must be a non-negative integer (saw: "${pullRequest}"); pass a number like --pull-request=42`,
    )
  }

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

  await handleCreateNewScan({
    autoManifest: Boolean(autoManifest),
    basics: Boolean(basics),
    branchName: branchName as string,
    commitHash: (commitHash && String(commitHash)) || '',
    commitMessage: (commitMessage && String(commitMessage)) || '',
    committers: (committers && String(committers)) || '',
    cwd,
    defaultBranch: Boolean(makeDefaultBranch),
    interactive: Boolean(interactive),
    orgSlug,
    outputKind,
    pendingHead: Boolean(pendingHead),
    pullRequest: validatedPullRequest,
    reach: {
      excludePaths,
      runReachabilityAnalysis: Boolean(reach),
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
    readOnly: Boolean(readOnly),
    repoName,
    report,
    reportLevel,
    targets,
    tmp: Boolean(tmp),
    workspace: (workspace && String(workspace)) || '',
  })
}
