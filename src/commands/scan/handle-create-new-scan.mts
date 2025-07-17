import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { handleScanReport } from './handle-scan-report.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import constants from '../../constants.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { readOrDefaultSocketJson } from '../../utils/socketjson.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { OutputKind } from '../../types.mts'

export async function handleCreateNewScan({
  autoManifest,
  branchName,
  commitHash,
  commitMessage,
  committers,
  cwd,
  defaultBranch,
  interactive,
  orgSlug,
  outputKind,
  pendingHead,
  pullRequest,
  readOnly,
  repoName,
  report,
  targets,
  tmp,
}: {
  autoManifest: boolean
  branchName: string
  commitHash: string
  commitMessage: string
  committers: string
  cwd: string
  defaultBranch: boolean
  interactive: boolean
  orgSlug: string
  pendingHead: boolean
  pullRequest: number
  outputKind: OutputKind
  readOnly: boolean
  repoName: string
  report: boolean
  targets: string[]
  tmp: boolean
}): Promise<void> {
  if (autoManifest) {
    logger.info('Auto-generating manifest files ...')
    const sockJson = await readOrDefaultSocketJson(cwd)
    const detected = await detectManifestActions(sockJson, cwd)
    await generateAutoManifest({
      detected,
      cwd,
      outputKind,
      verbose: false,
    })
    logger.info('Auto-generation finished. Proceeding with Scan creation.')
  }

  const supportedFilesCResult = await fetchSupportedScanFileNames()
  if (!supportedFilesCResult.ok) {
    await outputCreateNewScan(supportedFilesCResult, outputKind, interactive)
    return
  }

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Searching for local files to include in scan...')

  const supportedFiles = supportedFilesCResult.data
  const packagePaths = await getPackageFilesForScan(targets, supportedFiles, {
    cwd,
  })

  spinner.stop()

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: packagePaths.length > 0,
    pass: 'ok',
    fail: 'found no eligible files to scan',
    message:
      'TARGET (file/dir) must contain matching / supported file types for a scan',
  })
  if (!wasValidInput) {
    return
  }

  debugFn(
    'notice',
    `found: ${packagePaths.length} local ${pluralize('file', packagePaths.length)}`,
  )
  debugDir('inspect', { packagePaths })

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    return
  }

  const fullScanCResult = await fetchCreateOrgFullScan(
    packagePaths,
    orgSlug,
    defaultBranch,
    pendingHead,
    tmp,
    cwd,
    {
      commitHash,
      commitMessage,
      committers,
      pullRequest,
      repoName,
      branchName,
    },
  )

  if (fullScanCResult.ok && report) {
    if (fullScanCResult.data?.id) {
      await handleScanReport({
        filePath: '-',
        fold: 'version',
        includeLicensePolicy: true,
        orgSlug,
        outputKind,
        reportLevel: 'error',
        scanId: fullScanCResult.data.id,
        short: false,
      })
    } else {
      await outputCreateNewScan(
        {
          ok: false,
          message: 'Missing Scan ID',
          cause: 'Server did not respond with a scan ID',
          data: fullScanCResult.data,
        },
        outputKind,
        interactive,
      )
    }
  } else {
    await outputCreateNewScan(fullScanCResult, outputKind, interactive)
  }
}
