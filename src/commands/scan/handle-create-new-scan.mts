import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { handleScanReport } from './handle-scan-report.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import {
  extractTier1ReachabilityScanId,
  spawnCoana,
} from '../../utils/coana.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { CResult, OutputKind } from '../../types.mts'

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
  reach,
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
  reach: boolean
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
    fail: 'found no eligible files to scan',
    message:
      'TARGET (file/dir) must contain matching / supported file types for a scan',
  })
  if (!wasValidInput) {
    return
  }

  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', packagePaths.length)}`,
  )

  debugDir('inspect', { packagePaths })

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    return
  }

  let scanPaths: string[] = packagePaths
  let tier1ReachabilityScanId: string | undefined

  // If reachability is enabled, perform reachability analysis
  if (reach) {
    const reachResult = await performReachabilityAnalysis({
      packagePaths,
      orgSlug,
      cwd,
      repoName,
      branchName,
      outputKind,
      interactive,
    })

    if (!reachResult.ok) {
      await outputCreateNewScan(reachResult, outputKind, interactive)
      return
    }

    scanPaths = reachResult.data?.scanPaths || []
    tier1ReachabilityScanId = reachResult.data?.tier1ReachabilityScanId
  }

  const fullScanCResult = await fetchCreateOrgFullScan(
    scanPaths,
    orgSlug,
    {
      commitHash,
      commitMessage,
      committers,
      pullRequest,
      repoName,
      branchName,
    },
    {
      cwd,
      defaultBranch,
      pendingHead,
      tmp,
    },
  )

  if (
    fullScanCResult.ok &&
    reach &&
    tier1ReachabilityScanId &&
    fullScanCResult.data?.id
  ) {
    await finalizeTier1Scan(tier1ReachabilityScanId, fullScanCResult.data?.id)
  }

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

async function performReachabilityAnalysis({
  branchName,
  cwd,
  orgSlug,
  packagePaths,
  repoName,
}: {
  packagePaths: string[]
  orgSlug: string
  cwd: string
  repoName: string
  branchName: string
  outputKind: OutputKind
  interactive: boolean
}): Promise<
  CResult<{ scanPaths?: string[]; tier1ReachabilityScanId: string | undefined }>
> {
  logger.info('Starting reachability analysis...')

  packagePaths = packagePaths.filter(
    p =>
      /* Exclude DOT_SOCKET_DOT_FACTS_JSON from previous runs */ !p.includes(
        constants.DOT_SOCKET_DOT_FACTS_JSON,
      ),
  )

  // Lazily access constants.spinner.
  const { spinner } = constants

  // Setup SDK for uploading manifests
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  // Upload manifests to get tar hash
  spinner.start('Uploading manifests for reachability analysis...')
  const uploadCResult = await handleApiCall(
    sockSdk.uploadManifestFiles(orgSlug, packagePaths),
    { desc: 'upload manifests' },
  )
  spinner.stop()

  if (!uploadCResult.ok) {
    return uploadCResult
  }

  const tarHash = (uploadCResult.data as { tarHash?: string })?.tarHash
  if (!tarHash) {
    return {
      ok: false,
      message: 'Failed to get manifest tar hash',
      cause: 'Server did not return a tar hash for the uploaded manifests',
    }
  }

  logger.success(`Manifests uploaded successfully. Tar hash: ${tarHash}`)

  // Run Coana with the manifests tar hash
  logger.info('Running reachability analysis with Coana...')
  const coanaResult = await spawnCoana(
    [
      'run',
      cwd,
      '--output-dir',
      cwd,
      '--socket-mode',
      constants.DOT_SOCKET_DOT_FACTS_JSON,
      '--disable-report-submission',
      '--manifests-tar-hash',
      tarHash,
    ],
    {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        SOCKET_REPO_NAME: repoName,
        SOCKET_BRANCH_NAME: branchName,
        SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
      },
    },
  )

  if (!coanaResult.ok) {
    return coanaResult
  }

  logger.success('Reachability analysis completed successfully')

  // Use the DOT_SOCKET_DOT_FACTS_JSON file for the scan
  return {
    ok: true,
    data: {
      scanPaths: [constants.DOT_SOCKET_DOT_FACTS_JSON],
      tier1ReachabilityScanId: extractTier1ReachabilityScanId(
        constants.DOT_SOCKET_DOT_FACTS_JSON,
      ),
    },
  }
}
