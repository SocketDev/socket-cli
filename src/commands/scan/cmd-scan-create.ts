import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCreateNewScan } from './handle-create-new-scan'
import { suggestOrgSlug } from './suggest-org-slug'
import { suggestRepoSlug } from './suggest-repo-slug'
import { suggestBranchSlug } from './suggest_branch_slug'
import { suggestTarget } from './suggest_target'
import constants from '../../constants'
import { commonFlags } from '../../flags'
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
    repo: {
      type: 'string',
      shortFlag: 'r',
      default: '',
      description: 'Repository name'
    },
    branch: {
      type: 'string',
      shortFlag: 'b',
      default: '',
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
    cwd: {
      type: 'string',
      description: 'working directory, defaults to process.cwd()'
    },
    dryRun: {
      type: 'boolean',
      description:
        'run input validation part of command without any concrete side effects'
    },
    pullRequest: {
      type: 'number',
      shortFlag: 'pr',
      description: 'Commit hash'
    },
    committers: {
      type: 'string',
      shortFlag: 'c',
      default: '',
      description: 'Committers'
    },
    defaultBranch: {
      type: 'boolean',
      shortFlag: 'db',
      default: false,
      description: 'Make default branch'
    },
    pendingHead: {
      type: 'boolean',
      shortFlag: 'ph',
      default: false,
      description: 'Set as pending head'
    },
    readOnly: {
      type: 'boolean',
      default: false,
      description:
        'Similar to --dry-run except it can read from remote, stops before it would create an actual report'
    },
    tmp: {
      type: 'boolean',
      shortFlag: 't',
      default: false,
      description:
        'Set the visibility (true/false) of the scan in your dashboard'
    },
    view: {
      type: 'boolean',
      shortFlag: 'v',
      default: true,
      description:
        'Will wait for and return the created report. Use --no-view to disable.'
    }
  },
  // TODO: your project's "socket.yml" file's "projectIgnorePaths"
  help: (command, config) => `
    Usage
      $ ${command} [...options] <org> <TARGET> [TARGET...]

    Uploads the specified "package.json" and lock files for JavaScript, Python,
    Go, Scala, Gradle, and Kotlin dependency manifests.
    If any folder is specified, the ones found in there recursively are uploaded.

    Supports globbing such as "**/package.json", "**/requirements.txt", etc.

    Ignores any file specified in your project's ".gitignore" and also has a
    sensible set of default ignores from the "ignore-by-default" module.

    TARGET should be a FILE or DIR that _must_ be inside the CWD.

    When a FILE is given only that FILE is targeted. Otherwise any eligible
    files in the given DIR will be considered.

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

  const { cwd: cwdOverride, dryRun } = cli.flags
  const defaultOrgSlug = getConfigValue('defaultOrg')
  let orgSlug = defaultOrgSlug || cli.input[0] || ''
  let targets = cli.input.slice(defaultOrgSlug ? 0 : 1)

  const cwd =
    cwdOverride && cwdOverride !== 'process.cwd()'
      ? String(cwdOverride)
      : process.cwd()
  let { branch: branchName, repo: repoName } = cli.flags

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
  let repoDefaultBranch = ''
  // Only do suggestions with an apiToken and when not in dryRun mode
  if (apiToken && !dryRun) {
    if (!orgSlug) {
      const suggestion = await suggestOrgSlug()
      if (suggestion) {
        orgSlug = suggestion
      }
      updatedInput = true
    }

    // (Don't bother asking for the rest if we didn't get an org slug above)
    if (orgSlug && !repoName) {
      const suggestion = await suggestRepoSlug(orgSlug)
      if (suggestion) {
        repoDefaultBranch = suggestion.defaultBranch
        repoName = suggestion.slug
      }
      updatedInput = true
    }

    // (Don't bother asking for the rest if we didn't get an org/repo above)
    if (orgSlug && repoName && !branchName) {
      const suggestion = await suggestBranchSlug(repoDefaultBranch)
      if (suggestion) {
        branchName = suggestion
      }
      updatedInput = true
    }
  }

  if (updatedInput && repoName && branchName && orgSlug && targets?.length) {
    logger.error(
      'Note: You can invoke this command next time to skip the interactive questions:'
    )
    logger.error('```')
    logger.error(
      `    socket scan create [other flags...] --repo ${repoName} --branch ${branchName} ${orgSlug} ${targets.join(' ')}`
    )
    logger.error('```\n')
  }

  const wasBadInput = handleBadInput(
    {
      hide: defaultOrgSlug,
      test: orgSlug,
      message: 'Org name as the first argument',
      pass: 'ok',
      fail: 'missing'
    },
    {
      test: repoName,
      message: 'Repository name using --repo',
      pass: 'ok',
      fail: typeof repoName !== 'string' ? 'missing' : 'invalid'
    },
    {
      test: branchName,
      message: 'Repository name using --branch',
      pass: 'ok',
      fail: typeof repoName !== 'string' ? 'missing' : 'invalid'
    },
    {
      test: targets.length,
      message: 'At least one TARGET (e.g. `.` or `./package.json`)',
      pass: 'ok',
      fail: 'missing'
    },
    {
      hide: apiToken,
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
    commitMessage: (cli.flags['commitMessage'] as string) ?? '',
    cwd,
    defaultBranch: Boolean(cli.flags['defaultBranch']),
    orgSlug,
    pendingHead: Boolean(cli.flags['pendingHead']),
    readOnly: Boolean(cli.flags['readOnly']),
    repoName: repoName as string,
    targets,
    tmp: Boolean(cli.flags['tmp'])
  })
}
