import process from 'node:process'

import meowOrDie from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { createFullScan } from './create-full-scan.ts'
import { handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/output-formatting'
import { getPackageFilesFullScans } from '../../utils/path-resolve'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

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
    tmp: {
      type: 'boolean',
      shortFlag: 't',
      default: false,
      description:
        'Set the visibility (true/false) of the scan in your dashboard'
    }
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} [...options] <org>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} --org=FakeOrg --repo=test-repo --branch=main ./package.json
  `
}

export const cmdScanCreate = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrDie(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  const orgSlug = cli.input[0] ?? '' // TODO: if nobody uses this then get rid of it in favor of --org
  const cwd = process.cwd()

  const socketSdk = await setupSdk()
  const supportedFiles = await socketSdk
    .getReportSupportedFiles()
    .then(res => {
      if (!res.success)
        handleUnsuccessfulApiResponse(
          'getReportSupportedFiles',
          res,
          new Spinner()
        )
      // TODO: verify type at runtime? Consider it trusted data and assume type?
      return (res as any).data
    })
    .catch((cause: Error) => {
      throw new Error('Failed getting supported files for report', { cause })
    })

  const packagePaths = await getPackageFilesFullScans(
    cwd,
    cli.input,
    supportedFiles
  )

  const { branch: branchName, repo: repoName } = cli.flags

  if (!orgSlug || !repoName || !branchName || !packagePaths.length) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
    - Org name as the argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
    - Repository name using --repo ${!repoName ? colors.red('(missing!)') : colors.green('(ok)')}\n
    - Branch name using --branch ${!branchName ? colors.red('(missing!)') : colors.green('(ok)')}\n
    - At least one file path (e.g. ./package.json) ${!packagePaths.length ? colors.red('(missing or no matching/supported files found!)') : colors.green('(ok)')}`)
    config.help(parentName, config)
    return
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await createFullScan({
    apiToken,
    orgSlug,
    repoName: repoName as string,
    branchName: branchName as string,
    commitMessage: (cli.flags['commitMessage'] as string) ?? '',
    defaultBranch: Boolean(cli.flags['defaultBranch']),
    pendingHead: Boolean(cli.flags['pendingHead']),
    tmp: Boolean(cli.flags['tmp']),
    packagePaths,
    commitHash: (cli.flags['commitHash'] as string) ?? '',
    committers: (cli.flags['committers'] as string) ?? '',
    pullRequest: (cli.flags['pullRequest'] as number) ?? undefined
  })
}
