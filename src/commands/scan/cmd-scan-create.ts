import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { createFullScan } from './create-full-scan.ts'
import { handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { meowOrExit } from '../../utils/meow-with-subcommands'
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
  argv: readonly string[],
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

  // Note exiting earlier to skirt a hidden auth requirement
  if (cli.flags['dryRun']) return console.log('[DryRun] Bailing now')

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
    targets,
    supportedFiles
  )

  const { branch: branchName, repo: repoName } = cli.flags

  if (!orgSlug || !repoName || !branchName || !packagePaths.length) {
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
    - Org name as the first argument ${!orgSlug ? colors.red('(missing!)') : colors.green('(ok)')}\n
    - Repository name using --repo ${!repoName ? colors.red('(missing!)') : colors.green('(ok)')}\n
    - Branch name using --branch ${!branchName ? colors.red('(missing!)') : colors.green('(ok)')}\n
    - At least one TARGET (e.g. \`.\` or \`./package.json\`) ${
      !packagePaths.length
        ? colors.red(
            targets.length > 0
              ? '(TARGET' +
                  (targets.length ? 's' : '') +
                  ' contained no matching/supported files!)'
              : '(missing)'
          )
        : colors.green('(ok)')
    }`)
    process.exitCode = 2 // bad input
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
    cwd,
    commitHash: (cli.flags['commitHash'] as string) ?? '',
    committers: (cli.flags['committers'] as string) ?? '',
    pullRequest: (cli.flags['pullRequest'] as number) ?? undefined
  })
}
