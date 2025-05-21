import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import { suggestTarget } from './suggest_target.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { isTestingV1 } from '../../utils/config.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'create',
  description: 'Create a scan',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    branch: {
      type: 'string',
      shortFlag: 'b',
      default: 'socket-default-branch',
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
      default: 'socket-default-repository',
      description: 'Repository name',
    },
    report: {
      type: 'boolean',
      default: false,
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
      $ ${command} [...options]${isTestingV1() ? '' : ' <org>'} <TARGET> [TARGET...]

    API Token Requirements
      - Quota: 1 unit
      - Permissions: full-scans:create

    Uploads the specified "package.json" and lock files for JavaScript, Python,
    Go, Scala, Gradle, and Kotlin dependency manifests.
    If any folder is specified, the ones found in there recursively are uploaded.

    Supports globbing such as "**/package.json", "**/requirements.txt", etc.

    Ignores any file specified in your project's ".gitignore" and also has a
    sensible set of default ignores from the "ignore-by-default" module.

    TARGET should be a FILE or DIR that _must_ be inside the CWD.

    When a FILE is given only that FILE is targeted. Otherwise any eligible
    files in the given DIR will be considered.

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

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command}${isTestingV1() ? '' : ' FakeOrg'} .
      $ ${command} --repo=test-repo --branch=main${isTestingV1() ? '' : ' FakeOrg'} ./package.json
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
    branch: branchName = 'socket-default-branch',
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
    repo: repoName = 'socket-default-repository',
    report,
    setAsAlertsPage: pendingHeadFlag,
    tmp,
  } = cli.flags as {
    branch: string
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
    repo: string
    report: boolean
    setAsAlertsPage: boolean
    tmp: boolean
  }
  const outputKind = getOutputKind(json, markdown)

  const pendingHead = tmp ? false : pendingHeadFlag

  let [orgSlug, defaultOrgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    cli.input[0] || '',
    interactive,
    dryRun,
  )
  if (!defaultOrgSlug) {
    // Tmp. just for TS. will drop this later.
    defaultOrgSlug = ''
  }

  let targets = cli.input.slice(isTestingV1() || defaultOrgSlug ? 0 : 1)

  const cwd =
    cwdOverride && cwdOverride !== 'process.cwd()'
      ? String(cwdOverride)
      : process.cwd()

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const hasApiToken = hasDefaultToken()

  // If we updated any inputs then we should print the command line to repeat
  // the command without requiring user input, as a suggestion.
  let updatedInput = false

  if (!targets.length && !dryRun && interactive) {
    const received = await suggestTarget()
    targets = received ?? []
    updatedInput = true
  }

  // If the current cwd is unknown and is used as a repo slug anyways, we will
  // first need to register the slug before we can use it.
  // Only do suggestions with an apiToken and when not in dryRun mode
  if (hasApiToken && !dryRun && interactive) {
    if (!orgSlug) {
      const suggestion = await suggestOrgSlug()
      if (suggestion) {
        orgSlug = suggestion
      }
      updatedInput = true
    }
  }

  if (updatedInput && orgSlug && targets?.length) {
    logger.info(
      'Note: You can invoke this command next time to skip the interactive questions:',
    )
    logger.info('```')
    logger.info(
      `    socket scan create [other flags...] ${defaultOrgSlug ? '' : orgSlug} ${targets.join(' ')}`,
    )
    logger.info('```\n')
  }

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: !isTestingV1() && !!defaultOrgSlug,
      test: !!orgSlug && orgSlug !== '.',
      message: isTestingV1()
        ? 'Org name by default setting, --org, or auto-discovered'
        : 'Org name must be the first argument',
      pass: 'ok',
      fail:
        orgSlug === '.'
          ? 'dot is an invalid org, most likely you forgot the org name here?'
          : 'missing',
    },
    {
      test: !!targets.length,
      message: 'At least one TARGET (e.g. `.` or `./package.json`)',
      pass: 'ok',
      fail: 'missing (or perhaps you forgot the org slug?)',
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
