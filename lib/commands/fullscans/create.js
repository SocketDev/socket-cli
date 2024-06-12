/* eslint-disable no-console */

import { stdin as inputText, stdout as output } from 'node:process'
import * as readline from 'node:readline/promises'

import chalk from 'chalk'
import meow from 'meow'
import open from 'open'
import ora from 'ora'
import { ErrorWithCause } from 'pony-cause'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { createDebugLogger } from '../../utils/misc.js'
import { getPackageFilesFullScans } from '../../utils/path-resolve.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const create = {
  description: 'Create a full scan',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' create'

    const input = await setupCommand(name, create.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Creating a full scan... \n'
      const spinner = ora(spinnerText).start()

      await createFullScan(input, spinner)
    }
  }
}

const createFullScanFlags = prepareFlags({
  repo: {
    type: 'string',
    shortFlag: 'r',
    default: '',
    description: 'Repository name',
  },
  branch: {
    type: 'string',
    shortFlag: 'b',
    default: '',
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
  pullRequest: {
    type: 'number',
    shortFlag: 'pr',
    description: 'Commit hash',
  },
  committers: {
    type: 'string',
    shortFlag: 'c',
    default: '',
    description: 'Committers',
  },
  defaultBranch: {
    type: 'boolean',
    shortFlag: 'db',
    default: false,
    description: 'Make default branch',
  },
  pendingHead: {
    type: 'boolean',
    shortFlag: 'ph',
    default: false,
    description: 'Set as pending head',
  },
  tmp: {
    type: 'boolean',
    shortFlag: 't',
    default: false,
    description: 'Set the visibility (true/false) of the full scan in your dashboard',
  }
})

// Internal functions

/**
 * @typedef CommandContext
 * @property {string} orgSlug
 * @property {string} repoName
 * @property {string} branchName
 * @property {string} committers
 * @property {string} commitMessage
 * @property {string} commitHash
 * @property {number | undefined} pullRequest
 * @property {boolean} defaultBranch
 * @property {boolean} pendingHead
 * @property {boolean} tmp
 * @property {string[]} packagePaths
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {Promise<void|CommandContext>}
 */
async function setupCommand (name, description, argv, importMeta) {
  const flags = {
    ...createFullScanFlags
  }

  const cli = meow(`
    Usage
      $ ${name}

    Options
      ${printFlagList(flags, 6)}
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    repo: repoName,
    branch: branchName,
    commitMessage,
    defaultBranch,
    pendingHead,
    tmp,
    committers,
    commitHash,
    pullRequest
  } = cli.flags

  if (!repoName) {
    throw new InputError('Please provide a repository name')
  }

  if (!cli.input[0]) {
    cli.showHelp()
    return
  }

  const orgSlug = cli.input[0] || ''

  const cwd = process.cwd()
  const socketSdk = await setupSdk()
  const supportedFiles = await socketSdk.getReportSupportedFiles()
  .then(res => {
    if (!res.success) handleUnsuccessfulApiResponse('getReportSupportedFiles', res, ora())
    return res.data
  }).catch(
    /** @type {(cause: Error) => never} */
    (cause) => {
      throw new ErrorWithCause('Failed getting supported files for report', { cause })
    })
  const debugLog = createDebugLogger(false)
  const packagePaths = await getPackageFilesFullScans(cwd, cli.input, supportedFiles, debugLog)

  return {
    orgSlug,
    repoName,
    branchName,
    commitMessage,
    defaultBranch,
    pendingHead,
    tmp,
    packagePaths,
    commitHash,
    committers,
    pullRequest
  }
}

/**
 * @typedef FullScanData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'CreateOrgFullScan'>["data"]} data
 */

/**
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|FullScanData>}
 */
async function createFullScan (input, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  const {
    orgSlug,
    repoName,
    branchName,
    commitMessage,
    defaultBranch,
    pendingHead,
    tmp,
    packagePaths
  } = input

  const result = await handleApiCall(socketSdk.createOrgFullScan(orgSlug, {
    repo: repoName,
    branch: branchName,
    commit_message: commitMessage,
    make_default_branch: defaultBranch,
    set_as_pending_head: pendingHead,
    tmp
  }, packagePaths), 'Creating full scan')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('CreateOrgFullScan', result, spinner)
  }
  spinner.stop()

  console.log('\n✅ Full scan created successfully \n')
  const link = chalk.hex('#00FFFF').underline(`${result.data.html_report_url}`)
  console.log(`Available at: ${link} \n`)

  const rl = readline.createInterface({ input: inputText, output })

  const answer = await rl.question('Would you like to open it in your browser? (y/n) ')

  answer.toLowerCase() === 'y' && open(`${result.data.html_report_url}`)

  rl.close()

  return {
    data: result.data
  }
}
