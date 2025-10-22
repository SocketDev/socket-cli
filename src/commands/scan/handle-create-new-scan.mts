import path from 'node:path'

import { getSpinner } from '@socketsecurity/lib/constants/process'
import { debug, debugDir } from '@socketsecurity/lib/debug'
import { logger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { handleScanReport } from './handle-scan-report.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import { DOT_SOCKET_DOT_FACTS_JSON } from '../../constants/paths.mts'
import { FOLD_SETTING_VERSION } from '../../constants/reporting.mjs'
import { getPackageFilesForScan } from '../../utils/fs/path-resolve.mjs'
import { readOrDefaultSocketJson } from '../../utils/socket/json.mts'
import { socketDocsLink } from '../../utils/terminal/link.mts'
import { checkCommandInput } from '../../utils/validation/check-input.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { REPORT_LEVEL } from './types.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/lib/objects'

export type HandleCreateNewScanConfig = {
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
  reach: Remap<
    ReachabilityOptions & {
      runReachabilityAnalysis: boolean
    }
  >
  readOnly: boolean
  repoName: string
  report: boolean
  reportLevel: REPORT_LEVEL
  targets: string[]
  tmp: boolean
}

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
  reportLevel,
  targets,
  tmp,
}: HandleCreateNewScanConfig): Promise<void> {
  debug(`Creating new scan for ${orgSlug}/${repoName}`)
  debugDir({
    autoManifest,
    branchName,
    commitHash,
    defaultBranch,
    interactive,
    pendingHead,
    pullRequest,
    readOnly,
    report,
    reportLevel,
    targets,
    tmp,
  })

  if (autoManifest) {
    logger.info('Auto-generating manifest files ...')
    debug('Auto-manifest mode enabled')
    const sockJson = readOrDefaultSocketJson(cwd)
    const detected = await detectManifestActions(sockJson, cwd)
    debugDir({ detected })
    await generateAutoManifest({
      detected,
      cwd,
      outputKind,
      verbose: false,
    })
    logger.info('Auto-generation finished. Proceeding with Scan creation.')
  }

  const spinner = getSpinner()!
  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    debug('Failed to fetch supported scan file names')
    debugDir({ supportedFilesCResult })
    await outputCreateNewScan(supportedFilesCResult, {
      interactive,
      outputKind,
    })
    return
  }
  debug(`Fetched ${supportedFilesCResult.data['size']} supported file types`)

  spinner.start('Searching for local files to include in scan...')

  const supportedFiles = supportedFilesCResult.data
  const packagePaths = await getPackageFilesForScan(targets, supportedFiles, {
    cwd,
  })

  spinner.successAndStop(
    `Found ${packagePaths.length} ${pluralize('file', { count: packagePaths.length })} to include in scan.`,
  )

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: packagePaths.length > 0,
    fail: `found no eligible files to scan. See supported manifest files at ${socketDocsLink('/docs/manifest-file-detection-in-socket', 'docs.socket.dev')}`,
    message:
      'TARGET (file/dir) must contain matching / supported file types for a scan',
  })
  if (!wasValidInput) {
    debug('No eligible files found to scan')
    return
  }

  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', { count: packagePaths.length })}`,
  )

  debugDir({ packagePaths })

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    debug('Read-only mode, exiting early')
    return
  }

  let scanPaths: string[] = packagePaths
  let tier1ReachabilityScanId: string | undefined

  // If reachability is enabled, perform reachability analysis.
  if (reach.runReachabilityAnalysis) {
    logger.error('')
    logger.info('Starting reachability analysis...')
    debug('Reachability analysis enabled')
    debugDir({ reachabilityOptions: reach })

    spinner.start()

    const reachResult = await performReachabilityAnalysis({
      branchName,
      cwd,
      orgSlug,
      packagePaths,
      reachabilityOptions: reach,
      repoName,
      spinner,
    })

    spinner.stop()

    if (!reachResult.ok) {
      await outputCreateNewScan(reachResult, { interactive, outputKind })
      return
    }

    logger.success('Reachability analysis completed successfully')

    const reachabilityReport = reachResult.data?.reachabilityReport

    scanPaths = [
      ...packagePaths.filter(
        // Ensure the .socket.facts.json isn't duplicated in case it happened
        // to be in the scan folder before the analysis was run.
        p => path.basename(p).toLowerCase() !== DOT_SOCKET_DOT_FACTS_JSON,
      ),
      ...(reachabilityReport ? [reachabilityReport] : []),
    ]

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

  const scanId = fullScanCResult.ok ? fullScanCResult.data?.id : undefined

  if (reach && scanId && tier1ReachabilityScanId) {
    await finalizeTier1Scan(tier1ReachabilityScanId, scanId)
  }

  if (report && fullScanCResult.ok) {
    if (scanId) {
      await handleScanReport({
        filepath: '-',
        fold: FOLD_SETTING_VERSION,
        includeLicensePolicy: true,
        orgSlug,
        outputKind,
        reportLevel,
        scanId,
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

    await outputCreateNewScan(fullScanCResult, { interactive, outputKind })
  }
}
