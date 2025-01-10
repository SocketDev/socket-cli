import { stdin as inputText, stdout as output } from 'node:process'
import readline from 'node:readline/promises'

import meow from 'meow'
import open from 'open'
import { ErrorWithCause } from 'pony-cause'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { AuthError } from '../../utils/errors'
import { printFlagList } from '../../utils/formatting'
import { createDebugLogger } from '../../utils/misc'
import { getPackageFilesFullScans } from '../../utils/path-resolve'
import { getDefaultKey, setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'

export const create: CliSubcommand = {
  description: 'Create a scan',
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} create`
    const input = await setupCommand(name, create.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinnerText = 'Creating a scan... \n'
      const spinner = new Spinner({ text: spinnerText }).start()
      await createFullScan(input, spinner, apiKey)
    }
  }
}

const createFullScanFlags: { [key: string]: any } = {
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
    description: 'Set the visibility (true/false) of the scan in your dashboard'
  }
}

// Internal functions

type CommandContext = {
  orgSlug: string
  repoName: string
  branchName: string
  committers: string
  commitMessage: string
  commitHash: string
  pullRequest: number | undefined
  defaultBranch: boolean
  pendingHead: boolean
  tmp: boolean
  packagePaths: string[]
}

async function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): Promise<CommandContext | undefined> {
  const flags: { [key: string]: any } = {
    ...createFullScanFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} [...options]

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} --org=FakeOrg --repo=test-repo --branch=main ./package.json
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  let showHelp = cli.flags['help']
  if (!cli.input[0]) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const { 0: orgSlug = '' } = cli.input
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
      return (res as any).data
    })
    .catch(
      /** @type {(cause: Error) => never} */
      cause => {
        throw new ErrorWithCause('Failed getting supported files for report', {
          cause
        })
      }
    )
  const debugLog = createDebugLogger(false)
  const packagePaths = await getPackageFilesFullScans(
    cwd,
    cli.input,
    supportedFiles,
    debugLog
  )
  const { branch: branchName, repo: repoName } = cli.flags
  if (!repoName || !branchName || !packagePaths.length) {
    showHelp = true
    console.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
    - Repository name using --repo\n
    - Branch name using --branch\n
    - At least one file path (e.g. ./package.json)`)
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  return <CommandContext>{
    orgSlug,
    repoName,
    branchName,
    commitMessage: cli.flags['commitMessage'],
    defaultBranch: cli.flags['defaultBranch'],
    pendingHead: cli.flags['pendingHead'],
    tmp: cli.flags['tmp'],
    packagePaths,
    commitHash: cli.flags['commitHash'],
    committers: cli.flags['committers'],
    pullRequest: cli.flags['pullRequest']
  }
}

async function createFullScan(
  input: CommandContext,
  spinner: Spinner,
  apiKey: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const {
    branchName,
    commitMessage,
    defaultBranch,
    orgSlug,
    packagePaths,
    pendingHead,
    repoName,
    tmp
  } = input
  const result = await handleApiCall(
    socketSdk.createOrgFullScan(
      orgSlug,
      {
        repo: repoName,
        branch: branchName,
        commit_message: commitMessage,
        make_default_branch: defaultBranch,
        set_as_pending_head: pendingHead,
        tmp
      },
      packagePaths
    ),
    'Creating scan'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('CreateOrgFullScan', result, spinner)
    return
  }

  spinner.success('Scan created successfully')

  const link = colors.underline(colors.cyan(`${result.data.html_report_url}`))
  console.log(`Available at: ${link}`)

  const rl = readline.createInterface({ input: inputText, output })

  const answer = await rl.question(
    'Would you like to open it in your browser? (y/n)'
  )

  if (answer.toLowerCase() === 'y') {
    await open(`${result.data.html_report_url}`)
  }
  rl.close()
}
