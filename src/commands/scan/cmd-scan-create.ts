import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { createFullScan } from './create-full-scan'
import constants from '../../constants'
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
    }
  },
  help: (command, config) => `
    Usage
      $ ${command} [...options] <org> <TARGET> [TARGET...]

    Where TARGET is a FILE or DIR that _must_ be inside the CWD.

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

  const [orgSlug = '', ...targets] = cli.input

  const cwd =
    cli.flags['cwd'] && cli.flags['cwd'] !== 'process.cwd()'
      ? String(cli.flags['cwd'])
      : process.cwd()

  let { branch: branchName, repo: repoName } = cli.flags

  const apiToken = getDefaultToken()

  if (!apiToken && (!orgSlug || !repoName || !branchName || !targets.length)) {
    // Without api token we cannot recover because we can't request more info
    // from the server, to match and help with the current cwd/git status.
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
      - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Repository name using --repo ${!repoName ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - Branch name using --branch ${!branchName ? colors.red('(missing!)') : colors.green('(ok)')}\n
      - At least one TARGET (e.g. \`.\` or \`./package.json\`) ${!targets.length ? '(missing)' : colors.green('(ok)')}\n
      (Additionally, no API Token was set so we cannot auto-discover these details)\n
    `)
    return
  }

  // Note exiting earlier to skirt a hidden auth requirement
  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await createFullScan({
    branchName: branchName as string,
    commitHash: (cli.flags['commitHash'] as string) ?? '',
    commitMessage: (cli.flags['commitMessage'] as string) ?? '',
    committers: (cli.flags['committers'] as string) ?? '',
    cwd,
    defaultBranch: Boolean(cli.flags['defaultBranch']),
    orgSlug,
    pendingHead: Boolean(cli.flags['pendingHead']),
    pullRequest: (cli.flags['pullRequest'] as number) ?? undefined,
    readOnly: Boolean(cli.flags['readOnly']),
    repoName: repoName as string,
    targets,
    tmp: Boolean(cli.flags['tmp'])
  })
}
