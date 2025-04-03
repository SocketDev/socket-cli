import { logger } from '@socketsecurity/registry/lib/logger'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names'
import { outputCreateNewScan } from './output-create-new-scan'
import { handleBadInput } from '../../utils/handle-bad-input'
import { getPackageFilesForScan } from '../../utils/path-resolve'

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
  const supportedFileNames = await fetchSupportedScanFileNames()
  if (!supportedFileNames) {
    return
  }

  const packagePaths = await getPackageFilesForScan(
    cwd,
    targets,
    supportedFileNames
  )

  handleBadInput({
    nook: true,
    test: packagePaths.length > 0,
    pass: 'ok',
    fail: 'found none',
    message: 'TARGET must contain matching / supported file types for a scan'
  })

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
  if (!data) {
    return
  }

  await outputCreateNewScan(data)
}
