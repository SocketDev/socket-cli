import { logger } from '@socketsecurity/registry/lib/logger'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names'
import { handleScanReport } from './handle-scan-report'
import { outputCreateNewScan } from './output-create-new-scan'
import { handleBadInput } from '../../utils/handle-bad-input'
import { getPackageFilesForScan } from '../../utils/path-resolve'

export async function handleCreateNewScan({
  branchName,
  commitMessage,
  cwd,
  defaultBranch,
  orgSlug,
  outputKind,
  pendingHead,
  readOnly,
  repoName,
  report,
  targets,
  tmp
}: {
  branchName: string
  commitMessage: string
  cwd: string
  defaultBranch: boolean
  orgSlug: string
  pendingHead: boolean
  outputKind: 'json' | 'markdown' | 'text'
  readOnly: boolean
  repoName: string
  report: boolean
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

  if (
    handleBadInput({
      nook: true,
      test: packagePaths.length > 0,
      pass: 'ok',
      fail: 'found no eligible files to scan',
      message:
        'TARGET (file/dir) must contain matching / supported file types for a scan'
    })
  ) {
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
  if (!data) {
    return
  }

  if (report) {
    if (data?.id) {
      await handleScanReport({
        filePath: '-',
        fold: 'version',
        includeLicensePolicy: true,
        orgSlug,
        outputKind,
        reportLevel: 'error',
        scanId: data.id,
        short: false
      })
    } else {
      logger.fail('Failure: Server did not respond with a scan ID')
      process.exitCode = 1
    }
  } else {
    await outputCreateNewScan(data, outputKind)
  }
}
