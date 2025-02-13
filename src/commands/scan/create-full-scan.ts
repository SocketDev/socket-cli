import process from 'node:process'
import readline from 'node:readline/promises'

import open from 'open'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function createFullScan({
  apiToken,
  branchName,
  commitHash: _commitHash,
  commitMessage,
  committers: _committers,
  cwd,
  defaultBranch,
  orgSlug,
  packagePaths,
  pendingHead,
  pullRequest: _pullRequest,
  repoName,
  tmp
}: {
  apiToken: string
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
  cwd: string
}): Promise<void> {
  const spinnerText = 'Creating a scan... \n'
  const spinner = new Spinner({ text: spinnerText }).start()

  const socketSdk = await setupSdk(apiToken)
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

  spinner.success('Scan created successfully')

  const link = colors.underline(colors.cyan(`${result.data.html_report_url}`))
  console.log(`Available at: ${link}`)

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
