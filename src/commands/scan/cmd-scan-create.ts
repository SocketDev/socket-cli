import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCreateNewScan } from './handle-create-new-scan'
import { suggestOrgSlug } from './suggest-org-slug'
import { suggestTarget } from './suggest_target'
import constants from '../../constants'
import { commonFlags, outputFlags } from '../../flags'
import { getConfigValue } from '../../utils/config'
import { handleBadInput } from '../../utils/handle-bad-input'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getDefaultToken } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

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
      description: 'Branch name'
    },
    commitMessage: {
      type: 'string',
      shortFlag: 'm',
      default: '',
      description: 'Commit message'
    },
    commitHash: {
      type: 'string',
      shortFlag: 'ch',
      default: '',
      description: 'Commit hash'
    },
    committers: {
      type: 'string',
      shortFlag: 'c',
      default: '',
      description: 'Committers'
    },
    cwd: {
      type: 'string',
      description: 'working directory, defaults to process.cwd()'
    },
    defaultBranch: {
      type: 'boolean',
      default: false,
      description:
        'Set the default branch of the repository to the branch of this full-scan. Should only need to be done once, for example for the "main" or "master" branch.'
    },
    dryRun: {
      type: 'boolean',
      description:
        'Run input validation part of command without any concrete side effects'
    },
    pendingHead: {
      type: 'boolean',
      default: true,
      description:
        'Designate this full-scan as the latest scan of a given branch. This must be set to have it show up in the dashboard.'
    },
    pullRequest: {
      type: 'number',
      shortFlag: 'pr',
      description: 'Commit hash'
    },
    readOnly: {
      type: 'boolean',
      default: false,
      description:
        'Similar to --dry-run except it can read from remote, stops before it would create an actual report'
    },
    repo: {
      type: 'string',
      shortFlag: 'r',
      default: 'socket-default-repository',
      description: 'Repository name'
    },
    report: {
      type: 'boolean',
      default: false,
      description:
        'Wait for the scan creation to complete, then basically run `socket scan report` on it'
    },
    tmp: {
      type: 'boolean',
      shortFlag: 't',
      default: false,
      description:
        'Set the visibility (true/false) of the scan in your dashboard'
    }
  },
  // TODO: your project's "socket.yml" file's "projectIgnorePaths"
  help: (command, config) => `
    Usage
      $ ${command} [...options] <org> <TARGET> [TARGET...]

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

    Note: for a first run you probably want to set --defaultBranch to indicate
          the default branch name, like "main" or "master".

    Note: --pendingHead is enabled by default and makes a scan show up in your
          dashboard. You can use \`--no-pendingHead\` to have it not show up.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${command} --repo=test-repo --branch=main FakeOrg ./package.json
  `
}

export const cmdScanCreate = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const {
    branch: branchName = '',
    commitHash,
    commitMessage,
    committers,
    cwd: cwdOverride,
    defaultBranch,
    dryRun,
    json,
    markdown,
    pendingHead,
    pullRequest,
    readOnly,
    repo: repoName = '',
    report,
    tmp
  } = cli.flags as {
    branch: string
    cwd: string
    commitHash: string
    commitMessage: string
    committers: string
    defaultBranch: boolean
    dryRun: boolean
    json: boolean
    markdown: boolean
    pendingHead: boolean
    pullRequest: number
    readOnly: boolean
    repo: string
    report: boolean
    tmp: boolean
  }
  const defaultOrgSlug = getConfigValue('defaultOrg')
  let orgSlug = defaultOrgSlug || cli.input[0] || ''
  let targets = cli.input.slice(defaultOrgSlug ? 0 : 1)

  const cwd =
    cwdOverride && cwdOverride !== 'process.cwd()'
      ? String(cwdOverride)
      : process.cwd()

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const apiToken = getDefaultToken()

  // If we updated any inputs then we should print the command line to repeat
  // the command without requiring user input, as a suggestion.
  let updatedInput = false

  if (!targets.length && !dryRun) {
    const received = await suggestTarget()
    targets = received ?? []
    updatedInput = true
  }

  // If the current cwd is unknown and is used as a repo slug anyways, we will
  // first need to register the slug before we can use it.
  // Only do suggestions with an apiToken and when not in dryRun mode
  if (apiToken && !dryRun) {
    if (!orgSlug) {
      const suggestion = await suggestOrgSlug()
      if (suggestion) {
        orgSlug = suggestion
      }
      updatedInput = true
    }
  }

  if (updatedInput && orgSlug && targets?.length) {
    logger.error(
      'Note: You can invoke this command next time to skip the interactive questions:'
    )
    logger.error('```')
    logger.error(
      `    socket scan create [other flags...] ${defaultOrgSlug ? '' : orgSlug} ${targets.join(' ')}`
    )
    logger.error('```\n')
  }

  const wasBadInput = handleBadInput(
    {
      nook: !!defaultOrgSlug,
      test: orgSlug && orgSlug !== '.',
      message: 'Org name as the first argument',
      pass: 'ok',
      fail:
        orgSlug === '.'
          ? 'dot is an invalid org, most likely you forgot the org name here?'
          : 'missing'
    },
    {
      test: targets.length,
      message: 'At least one TARGET (e.g. `.` or `./package.json`)',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    },
    {
      nook: true,
      test: apiToken,
      message: 'This command requires an API token for access`)',
      pass: 'ok',
      fail: 'missing'
    }
  )
  if (wasBadInput) {
    return
  }

  // Note exiting earlier to skirt a hidden auth requirement
  if (dryRun) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await handleCreateNewScan({
    branchName: branchName as string,
    commitHash: (commitHash && String(commitHash)) || '',
    commitMessage: (commitMessage && String(commitMessage)) || '',
    committers: (committers && String(committers)) || '',
    cwd,
    defaultBranch: Boolean(defaultBranch),
    orgSlug,
    outputKind: json ? 'json' : markdown ? 'markdown' : 'text',
    pendingHead: Boolean(pendingHead),
    pullRequest: Number(pullRequest),
    readOnly: Boolean(readOnly),
    repoName: repoName,
    report,
    targets,
    tmp: Boolean(tmp)
  })
}
