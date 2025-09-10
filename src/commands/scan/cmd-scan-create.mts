import path from 'node:path'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { reachabilityFlags } from './reachability-flags.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import { suggestTarget } from './suggest_target.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getEcosystemChoicesForMeow } from '../../utils/ecosystem.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../utils/git.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'

import type { REPORT_LEVEL } from './types.mts'
import type { MeowFlags } from '../../flags.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

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
    description: 'working directory, defaults to process.cwd()',
  },
  defaultBranch: {
    type: 'boolean',
    default: false,
    description:
      'Set the default branch of the repository to the branch of this full-scan. Should only need to be done once, for example for the "main" or "master" branch.',
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
}

export const cmdScanCreate = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...generalFlags,
      ...reachabilityFlags,
    },
    // TODO: Your project's "socket.yml" file's "projectIgnorePaths".
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
    Kotlin, Python, and Scala. Files like "package.json" and "requirements.txt".
    If any folder is specified, the ones found in there recursively are uploaded.

    Details on TARGET:

    - Defaults to the current dir (cwd) if none given
    - Multiple targets can be specified
    - If a target is a file, only that file is checked
    - If it is a dir, the dir is scanned for any supported manifest files
    - Dirs MUST be within the current dir (cwd), you can use --cwd to change it
    - Supports globbing such as "**/package.json", "**/requirements.txt", etc.
    - Ignores any file specified in your project's ".gitignore"
    - Also a sensible set of default ignores from the "ignore-by-default" module

    The --repo and --branch flags tell Socket to associate this Scan with that
    repo/branch. The names will show up on your dashboard on the Socket website.

    Note: for a first run you probably want to set --default-branch to indicate
          the default branch name, like "main" or "master".

    The "alerts page" (https://socket.dev/dashboard/org/YOURORG/alerts) will show
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

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    commitHash,
    commitMessage,
    committers,
    cwd: cwdOverride,
    defaultBranch,
    interactive = true,
    json,
    markdown,
    org: orgFlag,
    pullRequest,
    reach,
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachDisableAnalytics,
    reachSkipCache,
    readOnly,
    reportLevel,
    setAsAlertsPage: pendingHeadFlag,
    tmp,
  } = cli.flags as {
    cwd: string
    commitHash: string
    commitMessage: string
    committers: string
    defaultBranch: boolean
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    pullRequest: number
    readOnly: boolean
    reportLevel: REPORT_LEVEL
    setAsAlertsPage: boolean
    tmp: boolean
    // Reachability flags.
    reach: boolean
    reachAnalysisTimeout: number
    reachAnalysisMemoryLimit: number
    reachDisableAnalytics: boolean
    reachSkipCache: boolean
  }

  // Validate ecosystem values.
  const reachEcosystems: PURL_Type[] = []
  const reachEcosystemsRaw = cmdFlagValueToArray(cli.flags['reachEcosystems'])
  const validEcosystems = getEcosystemChoicesForMeow()
  for (const ecosystem of reachEcosystemsRaw) {
    if (!validEcosystems.includes(ecosystem)) {
      throw new Error(
        `Invalid ecosystem: "${ecosystem}". Valid values are: ${joinAnd(validEcosystems)}`,
      )
    }
    reachEcosystems.push(ecosystem as PURL_Type)
  }

  const dryRun = !!cli.flags['dryRun']

  let {
    autoManifest,
    branch: branchName,
    repo: repoName,
    report,
  } = cli.flags as {
    autoManifest?: boolean | undefined
    branch: string
    repo: string
    report?: boolean | undefined
  }

  let{ 0: orgSlug } = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const processCwd = process.cwd()
  const cwd =
    cwdOverride && cwdOverride !== processCwd
      ? path.resolve(processCwd, String(cwdOverride))
      : processCwd

  const sockJson = readOrDefaultSocketJson(cwd)

  // Note: This needs meow booleanDefault=undefined.
  if (typeof autoManifest !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.autoManifest !== undefined) {
      autoManifest = sockJson.defaults.scan.create.autoManifest
      logger.info(
        'Using default --auto-manifest from socket.json:',
        autoManifest,
      )
    } else {
      autoManifest = false
    }
  }
  if (!branchName) {
    if (sockJson.defaults?.scan?.create?.branch) {
      branchName = sockJson.defaults.scan.create.branch
      logger.info('Using default --branch from socket.json:', branchName)
    } else {
      branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
    }
  }
  if (!repoName) {
    if (sockJson.defaults?.scan?.create?.repo) {
      repoName = sockJson.defaults.scan.create.repo
      logger.info('Using default --repo from socket.json:', repoName)
    } else {
      repoName = await getRepoName(cwd)
    }
  }
  if (typeof report !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.report !== undefined) {
      report = sockJson.defaults.scan.create.report
      logger.info('Using default --report from socket.json:', report)
    } else {
      report = false
    }
  }

  // If we updated any inputs then we should print the command line to repeat
  // the command without requiring user input, as a suggestion.
  let updatedInput = false

  // Accept zero or more paths. Default to cwd() if none given.
  let targets = cli.input || [cwd]

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
      'You can also run `socket scan setup` to persist these flag defaults to a socket.json file.',
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

  const isUsingNonDefaultAnalytics =
    reachDisableAnalytics !==
    reachabilityFlags['reachDisableAnalytics']?.default

  const isUsingAnyReachabilityFlags =
    isUsingNonDefaultMemoryLimit ||
    isUsingNonDefaultTimeout ||
    isUsingNonDefaultAnalytics ||
    hasReachEcosystems ||
    hasReachExcludePaths ||
    reachSkipCache

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
      test: !defaultBranch || !!branchName,
      message: 'When --default-branch is set, --branch is mandatory',
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
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleCreateNewScan({
    autoManifest: Boolean(autoManifest),
    branchName: branchName as string,
    commitHash: (commitHash && String(commitHash)) || '',
    commitMessage: (commitMessage && String(commitMessage)) || '',
    committers: (committers && String(committers)) || '',
    cwd,
    defaultBranch: Boolean(defaultBranch),
    interactive: Boolean(interactive),
    orgSlug,
    outputKind,
    pendingHead: Boolean(pendingHead),
    pullRequest: Number(pullRequest),
    reach: {
      runReachabilityAnalysis: Boolean(reach),
      reachDisableAnalytics: Boolean(reachDisableAnalytics),
      reachAnalysisTimeout: Number(reachAnalysisTimeout),
      reachAnalysisMemoryLimit: Number(reachAnalysisMemoryLimit),
      reachEcosystems,
      reachExcludePaths,
      reachSkipCache: Boolean(reachSkipCache),
    },
    readOnly: Boolean(readOnly),
    repoName,
    report,
    reportLevel,
    targets,
    tmp: Boolean(tmp),
  })
}
