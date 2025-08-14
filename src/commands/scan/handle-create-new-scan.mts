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
import { convertToCoanaEcosystems } from '../../utils/ecosystem.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

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
  reach: {
    runReachabilityAnalysis: boolean
    reachContinueOnFailingProjects: boolean
    reachDisableAnalytics: boolean
    reachAnalysisTimeout: number
    reachAnalysisMemoryLimit: number
    reachEcosystems: PURL_Type[]
    reachExcludePaths: string[]
  }
  readOnly: boolean
  repoName: string
  report: boolean
  targets: string[]
  tmp: boolean
}): Promise<void> {
  if (autoManifest) {
    logger.info('Auto-generating manifest files ...')
    const sockJson = readOrDefaultSocketJson(cwd)
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
    await outputCreateNewScan(supportedFilesCResult, {
      interactive,
      outputKind,
    })
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

  // If reachability is enabled, perform reachability analysis.
  if (reach.runReachabilityAnalysis) {
    logger.error('')
    logger.info('Starting reachability analysis...')

    spinner.start()

    const reachResult = await performReachabilityAnalysis(
      {
        packagePaths,
        orgSlug,
        cwd,
        repoName,
        branchName,
        reachabilityOptions: reach,
      },
      { spinner },
    )

    spinner.stop()

    if (!reachResult.ok) {
      await outputCreateNewScan(reachResult, { interactive, outputKind })
      return
    }

    logger.success('Reachability analysis completed successfully')

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
    reach &&
    tier1ReachabilityScanId &&
    fullScanCResult.ok &&
    fullScanCResult.data?.id
  ) {
    await finalizeTier1Scan(tier1ReachabilityScanId, fullScanCResult.data.id)
  }

  if (report && fullScanCResult.ok) {
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
        {
          interactive,
          outputKind,
        },
      )
    }
  } else {
    spinner.stop()
    spinner.clear()

    await outputCreateNewScan(fullScanCResult, { interactive, outputKind })
  }
}

type ReachabilityAnalysisConfig = {
  branchName: string
  cwd: string
  orgSlug: string
  packagePaths: string[]
  reachabilityOptions: {
    reachContinueOnFailingProjects: boolean
    reachDisableAnalytics: boolean
    reachAnalysisTimeout: number
    reachAnalysisMemoryLimit: number
    reachEcosystems: PURL_Type[]
    reachExcludePaths: string[]
  }
  repoName: string
}

type ReachabilityAnalysisOptions = {
  spinner?: Spinner | undefined
}

type ReachabilityAnalysisResult = {
  scanPaths: string[]
  tier1ReachabilityScanId: string | undefined
}

async function performReachabilityAnalysis(
  {
    branchName,
    cwd,
    orgSlug,
    packagePaths,
    reachabilityOptions,
    repoName,
  }: ReachabilityAnalysisConfig,
  options?: ReachabilityAnalysisOptions | undefined,
): Promise<CResult<ReachabilityAnalysisResult>> {
  const { spinner } = {
    __proto__: null,
    ...options,
  } as ReachabilityAnalysisOptions

  // Setup SDK for uploading manifests
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }

  const sockSdk = sockSdkCResult.data

  const wasSpinning = !!spinner?.isSpinning

  // Upload manifests to get tar hash
  spinner?.start('Uploading manifests for reachability analysis...')

  // Exclude DOT_SOCKET_DOT_FACTS_JSON from previous runs.
  const filteredPackagePaths = packagePaths.filter(
    p => !p.endsWith(constants.DOT_SOCKET_DOT_FACTS_JSON),
  )
  const uploadCResult = await handleApiCall(
    sockSdk.uploadManifestFiles(orgSlug, filteredPackagePaths),
    {
      desc: 'upload manifests',
      spinner,
    },
  )

  spinner?.stop()

  if (!uploadCResult.ok) {
    if (wasSpinning) {
      spinner.start()
    }
    return uploadCResult
  }

  const tarHash = (uploadCResult.data as { tarHash?: string })?.tarHash
  if (!tarHash) {
    if (wasSpinning) {
      spinner.start()
    }
    return {
      ok: false,
      message: 'Failed to get manifest tar hash',
      cause: 'Server did not return a tar hash for the uploaded manifests',
    }
  }

  spinner?.start()
  spinner?.success(`Manifests uploaded successfully. Tar hash: ${tarHash}`)
  spinner?.infoAndStop('Running reachability analysis with Coana...')

  // Run Coana with the manifests tar hash.
  const coanaResult = await spawnCoana(
    [
      'run',
      cwd,
      '--output-dir',
      cwd,
      '--socket-mode',
      constants.DOT_SOCKET_DOT_FACTS_JSON,
      '--disable-report-submission',
      ...(reachabilityOptions.reachAnalysisTimeout
        ? [
            '--analysis-timeout',
            reachabilityOptions.reachAnalysisTimeout.toString(),
          ]
        : []),
      ...(reachabilityOptions.reachAnalysisMemoryLimit
        ? [
            '--memory-limit',
            reachabilityOptions.reachAnalysisMemoryLimit.toString(),
          ]
        : []),
      ...(reachabilityOptions.reachDisableAnalytics
        ? ['--disable-analytics-sharing']
        : []),
      ...(reachabilityOptions.reachContinueOnFailingProjects
        ? ['--ignore-failing-workspaces']
        : []),
      // empty reachEcosystems implies scan all ecosystems
      ...(reachabilityOptions.reachEcosystems.length
        ? [
            '--ecosystems',
            convertToCoanaEcosystems(reachabilityOptions.reachEcosystems).join(
              ' ',
            ),
          ]
        : []),
      ...(reachabilityOptions.reachExcludePaths.length
        ? ['--exclude-dirs', reachabilityOptions.reachExcludePaths.join(' ')]
        : []),
      '--manifests-tar-hash',
      tarHash,
    ],
    {
      cwd,
      env: {
        ...process.env,
        SOCKET_REPO_NAME: repoName,
        SOCKET_BRANCH_NAME: branchName,
      },
      spinner,
      stdio: 'inherit',
    },
  )

  if (wasSpinning) {
    spinner.start()
  }
  return coanaResult.ok
    ? {
        ok: true,
        data: {
          // Use the DOT_SOCKET_DOT_FACTS_JSON file for the scan.
          scanPaths: [constants.DOT_SOCKET_DOT_FACTS_JSON],
          tier1ReachabilityScanId: extractTier1ReachabilityScanId(
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          ),
        },
      }
    : coanaResult
}
