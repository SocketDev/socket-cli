import process from 'node:process'

import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names'
import { outputCreateNewScan } from './output-create-new-scan'
import { AuthError } from '../../utils/errors'
import { getPackageFilesForScan } from '../../utils/path-resolve'
import { getDefaultToken } from '../../utils/sdk'

export async function handleCreateNewScan({
  branchName,
  commitMessage,
  cwd,
  defaultBranch,
  orgSlug,
  pendingHead,
  readOnly,
  repoName,
  targets,
  tmp
}: {
  branchName: string
  commitMessage: string
  cwd: string
  defaultBranch: boolean
  orgSlug: string
  pendingHead: boolean
  readOnly: boolean
  repoName: string
  targets: string[]
  tmp: boolean
}): Promise<void> {
  const apiToken = getDefaultToken()

  // Note: you need an apiToken to request supportedScanFileNames from the API
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to create and submit new scans. To log in, run the command `socket login` and enter your API key.'
    )
  }

  const supportedFileNames = await fetchSupportedScanFileNames()
  if (!supportedFileNames) return

  const packagePaths = await getPackageFilesForScan(
    cwd,
    targets,
    supportedFileNames
    // socketConfig
  )

  if (!packagePaths.length) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(stripIndents`
      ${colors.bgRed(colors.white('Input error'))}: The TARGET did not contain any matching / supported files for a scan
    `)
    return
  }

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    return
  }

  const data = await fetchCreateOrgFullScan(
    packagePaths,
    orgSlug,
    repoName,
    branchName,
    commitMessage,
    defaultBranch,
    pendingHead,
    tmp,
    cwd
  )
  if (!data) return

  await outputCreateNewScan(data)
}
