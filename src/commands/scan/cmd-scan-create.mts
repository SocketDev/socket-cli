import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import { suggestTarget } from './suggest_target.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { getRepoName, gitBranch } from '../../utils/git.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'
import { readOrDefaultSocketJson } from '../../utils/socketjson.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const {
  DRY_RUN_BAILING_NOW,
  SOCKET_DEFAULT_BRANCH,
  SOCKET_DEFAULT_REPOSITORY,
} = constants

const config: CliCommandConfig = {
  commandName: 'create',
  description: 'Create a scan',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    autoManifest: {
      type: 'boolean',
      description:
        'Run `socket manifest auto` before collecting manifest files? This would be necessary for languages like Scala, Gradle, and Kotlin, See `socket manifest auto --help`.',
    },
    branch: {
      type: 'string',
      shortFlag: 'b',
      description: 'Branch name',
    },
    commitMessage: {
      type: 'string',
      shortFlag: 'm',
      default: '',
      description: 'Commit message',
    },
    commitHash: {
      type: 'string',
      shortFlag: 'ch',
      default: '',
      description: 'Commit hash',
    },
    committers: {
      type: 'string',
      shortFlag: 'c',
      default: '',
      description: 'Committers',
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
      shortFlag: 'pr',
      description: 'Commit hash',
    },
    org: {
      type: 'string',
      description:
        'Force override the organization slug, overrides the default org from config',
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
    setAsAlertsPage: {
      type: 'boolean',
      default: true,
      aliases: ['pendingHead'],
      description:
        'When true and if this is the "default branch" then this Scan will be the one reflected on your alerts page. See help for details. Defaults to true.',
    },
    tmp: {
      type: 'boolean',
      shortFlag: 't',
      default: false,
      description:
        'Set the visibility (true/false) of the scan in your dashboard.',
    },
  },
  // TODO: your project's "socket.yml" file's "projectIgnorePaths"
  help: (command, config) => `
    Usage
      $ ${command} [options] [TARGET...]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:create

    Options
      ${getFlagListOutput(config.flags)}

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

    Note: for a first run you probably want to set --defaultBranch to indicate
          the default branch name, like "main" or "master".

    The "alerts page" (https://socket.dev/dashboard/org/YOURORG/alerts) will show
    the results from the last scan designated as the "pending head" on the branch
    configured on Socket to be the "default branch". When creating a scan the
    --setAsAlertsPage flag will default to true to update this. You can prevent
    this by using --no-setAsAlertsPage. This flag is ignored for any branch that
    is not designated as the "default branch". It is disabled when using --tmp.

    You can use \`socket scan setup\` to configure certain repo flag defaults.

    Examples
      $ ${command}
      $ ${command} ./proj --json
      $ ${command} --repo=test-repo --branch=main ./package.json
  `,
}

export const cmdScanCreate = {
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
    commitHash,
    commitMessage,
    committers,
    cwd: cwdOverride,
    defaultBranch,
    dryRun = false,
    interactive = true,
    json,
    markdown,
    org: orgFlag,
    pullRequest,
    readOnly,
    setAsAlertsPage: pendingHeadFlag,
    tmp,
  } = cli.flags as {
    cwd: string
    commitHash: string
    commitMessage: string
    committers: string
    defaultBranch: boolean
    dryRun: boolean
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    pullRequest: number
    readOnly: boolean
    setAsAlertsPage: boolean
    tmp: boolean
  }
  let {
    autoManifest,
    branch: branchName,
    repo: repoName,
    report,
  } = cli.flags as {
    autoManifest?: boolean
    branch: string
    repo: string
    report?: boolean
  }
  let [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )

  const cwd =
    cwdOverride && cwdOverride !== 'process.cwd()'
      ? path.resolve(process.cwd(), String(cwdOverride))
      : process.cwd()

  // Accept zero or more paths. Default to cwd() if none given.
  let targets = cli.input || [cwd]

  const sockJson = await readOrDefaultSocketJson(cwd)

  // Note: This needs meow booleanDefault=undefined
  if (typeof autoManifest !== 'boolean') {
    if (sockJson.defaults?.scan?.create?.autoManifest !== undefined) {
      autoManifest = sockJson.defaults.scan.create.autoManifest
      logger.info(
        'Using default --autoManifest from socket.json:',
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
      branchName = (await gitBranch(cwd)) || SOCKET_DEFAULT_BRANCH
    }
  }
  if (!repoName) {
    if (sockJson.defaults?.scan?.create?.repo) {
      repoName = sockJson.defaults.scan.create.repo
      logger.info('Using default --repo from socket.json:', repoName)
    } else {
      repoName = (await getRepoName(cwd)) || SOCKET_DEFAULT_REPOSITORY
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

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const hasApiToken = hasDefaultToken()

  const outputKind = getOutputKind(json, markdown)

  const pendingHead = tmp ? false : pendingHeadFlag

  // If we updated any inputs then we should print the command line to repeat
  // the command without requiring user input, as a suggestion.
  let updatedInput = false

  if (!targets.length && !dryRun && interactive) {
    targets = await suggestTarget()
    updatedInput = true
  }

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
          outputKind,
          false,
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
      `Detected ${detected.count} manifest targets we could try to generate. Please set the --autoManifest flag if you want to include languages covered by \`socket manifest auto\` in the Scan.`,
    )
  }

  if (updatedInput && orgSlug && targets?.length) {
    logger.info(
      'Note: You can invoke this command next time to skip the interactive questions:',
    )
    logger.info('```')
    logger.info(
      `    socket scan create [other flags...] ${orgSlug} ${targets.join(' ')}`,
    )
    logger.info('```')
    logger.error('')
    logger.info(
      'You can also run `socket scan setup` to persist these flag defaults to a socket.json file.',
    )
    logger.error('')
  }

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
      test: !!targets.length,
      message: 'At least one TARGET (e.g. `.` or `./package.json`)',
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
      message: 'This command requires an API token for access',
      pass: 'ok',
      fail: 'missing (try `socket login`)',
    },
    {
      nook: true,
      test: !pendingHead || !!branchName,
      message: 'When --pendingHead is set, --branch is mandatory',
      pass: 'ok',
      fail: 'missing branch name',
    },
    {
      nook: true,
      test: !defaultBranch || !!branchName,
      message: 'When --defaultBranch is set, --branch is mandatory',
      pass: 'ok',
      fail: 'missing branch name',
    },
  )
  if (!wasValidInput) {
    return
  }

  // Note exiting earlier to skirt a hidden auth requirement
  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
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
    readOnly: Boolean(readOnly),
    repoName: repoName,
    report,
    targets,
    tmp: Boolean(tmp),
  })
}
