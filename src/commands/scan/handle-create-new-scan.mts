import path from 'node:path'

import terminalLink from 'terminal-link'

import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { handleScanReport } from './handle-scan-report.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import constants from '../../constants.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

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
  reach: Remap<
    ReachabilityOptions & {
      runReachabilityAnalysis: boolean
    }
  >
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

  spinner.successAndStop(
    `Found ${packagePaths.length} ${pluralize('file', packagePaths.length)} to include in scan.`,
  )

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: packagePaths.length > 0,
    fail: `found no eligible files to scan. See supported manifest files at ${terminalLink('docs.socket.dev', 'https://docs.socket.dev/docs/manifest-file-detection-in-socket')}`,
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
        p =>
          path.basename(p).toLowerCase() !==
          constants.DOT_SOCKET_DOT_FACTS_JSON,
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
        filePath: '-',
        fold: 'version',
        includeLicensePolicy: true,
        orgSlug,
        outputKind,
        reportLevel: 'error',
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
