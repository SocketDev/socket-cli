import assert from 'node:assert'
import process from 'node:process'
import readline from 'node:readline/promises'

import open from 'open'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { suggestOrgSlug } from './suggest-org-slug'
import { suggestRepoSlug } from './suggest-repo-slug'
import { suggestBranchSlug } from './suggest_branch_slug'
import { suggestTarget } from './suggest_target'
import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getPackageFilesFullScans } from '../../utils/path-resolve'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function createFullScan({
  branchName,
  commitHash: _commitHash,
  commitMessage,
  committers: _committers,
  cwd,
  defaultBranch,
  orgSlug,
  pendingHead,
  pullRequest: _pullRequest,
  readOnly,
  repoName,
  targets,
  tmp
}: {
  branchName: string
  commitHash: string
  commitMessage: string
  committers: string
  cwd: string
  defaultBranch: boolean
  orgSlug: string
  pendingHead: boolean
  pullRequest: number | undefined
  readOnly: boolean
  repoName: string
  targets: string[]
  tmp: boolean
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants
  const socketSdk = await setupSdk()
  const supportedFiles = await socketSdk
    .getReportSupportedFiles()
    .then(res => {
      if (!res.success) {
        handleUnsuccessfulApiResponse('getReportSupportedFiles', res, spinner)
        assert(
          false,
          'handleUnsuccessfulApiResponse should unconditionally throw'
        )
      }

      return res.data
    })
    .catch((cause: Error) => {
      throw new Error('Failed getting supported files for report', { cause })
    })

  // If we updated any inputs then we should print the command line to repeat
  // the command without requiring user input, as a suggestion.
  let updatedInput = false

  if (!targets.length) {
    const received = await suggestTarget()
    targets = received ?? []
    updatedInput = true
  }

  const packagePaths = await getPackageFilesFullScans(
    cwd,
    targets,
    supportedFiles
  )

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const apiToken = getDefaultToken()

  if (apiToken && !orgSlug) {
    const suggestion = await suggestOrgSlug(socketSdk)
    if (suggestion) orgSlug = suggestion
    updatedInput = true
  }

  // If the current cwd is unknown and is used as a repo slug anyways, we will
  // first need to register the slug before we can use it.
  let repoDefaultBranch = ''

  // (Don't bother asking for the rest if we didn't get an org slug above)
  if (apiToken && orgSlug && !repoName) {
    const suggestion = await suggestRepoSlug(socketSdk, orgSlug)
    if (suggestion) {
      ;({ defaultBranch: repoDefaultBranch, slug: repoName } = suggestion)
    }
    updatedInput = true
  }

  // (Don't bother asking for the rest if we didn't get an org/repo above)
  if (apiToken && orgSlug && repoName && !branchName) {
    const suggestion = await suggestBranchSlug(repoDefaultBranch)
    if (suggestion) branchName = suggestion
    updatedInput = true
  }

  if (!orgSlug || !repoName || !branchName || !packagePaths.length) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(`
      ${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
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
      }\n
      ${!apiToken ? 'Note: was unable to make suggestions because no API Token was found; this would make command fail regardless\n' : ''}
    `)
    return
  }

  if (updatedInput) {
    logger.log(
      'Note: You can invoke this command next time to skip the interactive questions:'
    )
    logger.log('```')
    logger.log(
      `    socket scan create [other flags...] --repo ${repoName} --branch ${branchName} ${orgSlug} ${targets.join(' ')}`
    )
    logger.log('```')
  }

  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    return
  }

  spinner.start('Creating a scan...')

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
      packagePaths,
      cwd
    ),
    'Creating scan'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('CreateOrgFullScan', result, spinner)
    return
  }

  spinner.successAndStop('Scan created successfully')

  const link = colors.underline(colors.cyan(`${result.data.html_report_url}`))
  logger.log(`Available at: ${link}`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const answer = await rl.question(
    'Would you like to open it in your browser? (y/n)'
  )

  if (answer.toLowerCase() === 'y') {
    await open(`${result.data.html_report_url}`)
  }
  rl.close()
}
