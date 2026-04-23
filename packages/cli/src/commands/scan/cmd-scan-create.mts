import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib/arrays'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { reachabilityFlags } from './reachability-flags.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import { suggestTarget } from './suggest_target.mts'
import { validateReachabilityTarget } from './validate-reachability-target.mts'
import constants, { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
import { outputDryRunUpload } from '../../utils/dry-run/output.mts'
import { InputError } from '../../utils/error/errors.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mts'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem/types.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../utils/git/operations.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mts'
import { cmdFlagValueToArray } from '../../utils/process/cmd.mts'
import { readOrDefaultSocketJsonUp } from '../../utils/socket/json.mts'
import { determineOrgSlug } from '../../utils/socket/org-slug.mts'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mts'
import { socketDashboardLink } from '../../utils/terminal/link.mts'
import { checkCommandInput } from '../../utils/validation/check-input.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'

import type { REPORT_LEVEL } from './types.mts'
import type { MeowFlags } from '../../flags.mts'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mts'
import type { PURL_Type } from '../../utils/ecosystem/types.mts'

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

const generalFlags: MeowFlags = {
  ...commonFlags,
  ...outputFlags,
  autoManifest: {
    type: 'boolean',
    description:
      'Run `socket manifest auto` before collecting manifest files. This is necessary for languages like Scala, Gradle, and Kotlin, See `socket manifest auto --help`.',
  },
  basics: {
    type: 'boolean',
    default: false,
    description:
      'Run comprehensive security scanning (SAST, secrets, containers) via socket-basics. Requires Python, Trivy, TruffleHog, and OpenGrep to be available.',
  },
  branch: {
    type: 'string',
    default: '',
    description: 'Branch name',
    shortFlag: 'b',
  },
  commitHash: {
    type: 'string',
    default: '',
    description: 'Commit hash',
    shortFlag: 'ch',
  },
  commitMessage: {
    type: 'string',
    default: '',
    description: 'Commit message',
    shortFlag: 'm',
  },
  committers: {
    type: 'string',
    default: '',
    description: 'Committers',
    shortFlag: 'c',
  },
  cwd: {
    type: 'string',
    default: '',
    description: 'working directory, defaults to process.cwd()',
  },
  makeDefaultBranch: {
    type: 'boolean',
    default: false,
    description:
      'Reassign the repo\'s default-branch pointer at Socket to the branch of this scan. The previous default-branch designation is replaced. Mirrors the `make_default_branch` API field.',
  },
  // Deprecated alias for `--make-default-branch`. Declared as its own
  // boolean flag (rather than via meow `aliases`) because meow's alias
  // forwarding doesn't reliably propagate values in this command's
  // large flag set. We merge it onto `makeDefaultBranch` after parsing.
  defaultBranch: {
    type: 'boolean',
    default: false,
    description:
      'Deprecated alias for --make-default-branch. Kept working for back-compat; emits a deprecation warning on use.',
    hidden: true,
  },
  interactive: {
    type: 'boolean',
    default: true,
    description:
      'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
  },
  pullRequest: {
    type: 'number',
    default: 0,
    description: 'Pull request number',
    shortFlag: 'pr',
  },
  org: {
    type: 'string',
    default: '',
    description:
      'Force override the organization slug, overrides the default org from config',
  },
  reach: {
    type: 'boolean',
    default: false,
    description: 'Run tier 1 full application reachability analysis',
  },
  readOnly: {
    type: 'boolean',
    default: false,
    description:
      'Similar to --dry-run except it can read from remote, stops before it would create an actual report',
  },
  repo: {
    type: 'string',
    shortFlag: 'r',
    description: 'Repository name',
  },
  report: {
    type: 'boolean',
    description:
      'Wait for the scan creation to complete, then basically run `socket scan report` on it',
  },
  reportLevel: {
    type: 'string',
    default: constants.REPORT_LEVEL_ERROR,
    description: `Which policy level alerts should be reported (default '${constants.REPORT_LEVEL_ERROR}')`,
  },
  setAsAlertsPage: {
    type: 'boolean',
    default: true,
    description:
      'When true and if this is the "default branch" then this Scan will be the one reflected on your alerts page. See help for details. Defaults to true.',
    aliases: ['pendingHead'],
  },
  tmp: {
    type: 'boolean',
    default: false,
    description:
      'Set the visibility (true/false) of the scan in your dashboard.',
    shortFlag: 't',
  },
  workspace: {
    type: 'string',
    default: '',
    description:
      'The workspace in the Socket Organization that the repository is in to associate with the full scan.',
  },
}

// Legacy flag names kept working via meow aliases on `makeDefaultBranch`.
// Detected here so we can warn on use and keep the misuse heuristic
// working against both the primary and legacy names.
const LEGACY_DEFAULT_BRANCH_FLAGS = ['--default-branch', '--defaultBranch']
const LEGACY_DEFAULT_BRANCH_PREFIXES = LEGACY_DEFAULT_BRANCH_FLAGS.map(
  f => `${f}=`,
)
const DEFAULT_BRANCH_FLAGS = [
  '--make-default-branch',
  '--makeDefaultBranch',
  ...LEGACY_DEFAULT_BRANCH_FLAGS,
]
const DEFAULT_BRANCH_PREFIXES = DEFAULT_BRANCH_FLAGS.map(f => `${f}=`)

function hasLegacyDefaultBranchFlag(argv: readonly string[]): boolean {
  return argv.some(
    arg =>
      LEGACY_DEFAULT_BRANCH_FLAGS.includes(arg) ||
      LEGACY_DEFAULT_BRANCH_PREFIXES.some(p => arg.startsWith(p)),
  )
}

function isBareIdentifier(token: string): boolean {
  // Accept only tokens that look like a plain branch name. Anything
  // with a path separator, dot, or colon is almost certainly a target
  // path, URL, or something else the user meant as a positional arg.
  return /^[A-Za-z0-9_-]+$/.test(token)
}

function findDefaultBranchValueMisuse(
  argv: readonly string[],
): { form: string; value: string } | undefined {
  // `--default-branch=main` — unambiguous: the `=` form attaches a
  // value to what meow treats as a boolean flag, so the value is
  // silently dropped.
  for (const arg of argv) {
    const prefix = DEFAULT_BRANCH_PREFIXES.find(p => arg.startsWith(p))
    if (!prefix) {
      continue
    }
    const value = arg.slice(prefix.length)
    const normalized = value.toLowerCase()
    if (normalized === 'true' || normalized === 'false' || value === '') {
      continue
    }
    return { form: `${prefix}${value}`, value }
  }
  // `--default-branch main` — ambiguous in general (the next token
  // could be a positional target path), but if the next token is a
  // bare identifier (no `/`, `.`, `:`) AND the user didn't also pass
  // `--branch` / `-b`, it's almost certainly a mis-typed branch name.
  const hasBranchFlag = argv.some(
    arg =>
      arg === '--branch' ||
      arg === '-b' ||
      arg.startsWith('--branch=') ||
      arg.startsWith('-b='),
  )
  if (hasBranchFlag) {
    return undefined
  }
  for (let i = 0; i < argv.length - 1; i += 1) {
    const arg = argv[i]!
    if (!DEFAULT_BRANCH_FLAGS.includes(arg)) {
      continue
    }
    const next = argv[i + 1]!
    if (next.startsWith('-') || !isBareIdentifier(next)) {
      continue
    }
    return { form: `${arg} ${next}`, value: next }
  }
  return undefined
}

export const cmdScanCreate = {
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
    help: command => `
    Usage
      $ ${command} [options] [TARGET...]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(generalFlags)}

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
  for (const ecosystem of reachEcosystemsRaw) {
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

  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
    updatedInput = true
  }

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
    isUsingNonDefaultMemoryLimit ||
    isUsingNonDefaultTimeout ||
    isUsingNonDefaultConcurrency ||
    isUsingNonDefaultAnalytics ||
    hasReachEcosystems ||
    hasReachExcludePaths ||
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
