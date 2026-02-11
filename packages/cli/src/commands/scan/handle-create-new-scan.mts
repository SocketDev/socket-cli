import { existsSync } from 'node:fs'
import path from 'node:path'

import { debug, debugDir } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getDefaultSpinner } from '@socketsecurity/lib/spinner'
import { pluralize } from '@socketsecurity/lib/words'

const logger = getDefaultLogger()

import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { handleScanReport } from './handle-scan-report.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import {
  DOT_SOCKET_DOT_FACTS_JSON,
  FOLD_SETTING_VERSION,
  SCAN_TYPE_SOCKET,
  SCAN_TYPE_SOCKET_TIER1,
} from '../../constants.mts'
import { runSocketBasics } from '../../utils/basics/spawn.mts'

/**
 * Filter out .socket.facts.json files from scan paths to avoid duplicates.
 *
 * @param paths - Array of file paths to filter.
 * @returns Filtered paths without .socket.facts.json files.
 */
function excludeFactsJson(paths: string[]): string[] {
  return paths.filter(p => path.basename(p) !== DOT_SOCKET_DOT_FACTS_JSON)
}
import { getPackageFilesForScan } from '../../utils/fs/path-resolve.mts'
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
  basics: boolean
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
  basics,
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
  debug('notice', `Creating new scan for ${orgSlug}/${repoName}`)
  debugDir('inspect', {
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
    debug('notice', 'Auto-manifest mode enabled')
    const sockJson = readOrDefaultSocketJson(cwd)
    const detected = await detectManifestActions(sockJson, cwd)
    debugDir('inspect', { detected })
    await generateAutoManifest({
      detected,
      cwd,
      outputKind,
      verbose: false,
    })
    logger.info('Auto-generation finished. Proceeding with Scan creation.')
  }

  const spinner = getDefaultSpinner()

  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    debug('warn', 'Failed to fetch supported scan file names')
    debugDir('inspect', { supportedFilesCResult })
    await outputCreateNewScan(supportedFilesCResult, {
      interactive,
      outputKind,
    })
    return
  }
  debug(
    'notice',
    `Fetched ${supportedFilesCResult.data['size']} supported file types`,
  )

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
    debug('warn', 'No eligible files found to scan')
    return
  }

  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', { count: packagePaths.length })}`,
  )

  debugDir('inspect', { packagePaths })

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    debug('notice', 'Read-only mode, exiting early')
    return
  }

  let scanPaths: string[] = packagePaths
  let tier1ReachabilityScanId: string | undefined

  // If reachability is enabled, perform reachability analysis.
  if (reach.runReachabilityAnalysis) {
    if (!targets.length) {
      logger.fail('Reachability analysis requires at least one target')
      return
    }

    const [firstTarget] = targets
    if (!firstTarget) {
      logger.fail('Reachability analysis requires at least one valid target')
      return
    }

    logger.error('')
    logger.info('Starting reachability analysis...')
    debug('notice', 'Reachability analysis enabled')
    debugDir('inspect', { reachabilityOptions: reach })

    spinner.start()

    const reachResult = await performReachabilityAnalysis({
      branchName,
      cwd,
      orgSlug,
      packagePaths,
      reachabilityOptions: reach,
      repoName,
      spinner,
      target: firstTarget,
    })

    spinner.stop()

    if (!reachResult.ok) {
      await outputCreateNewScan(reachResult, { interactive, outputKind })
      return
    }

    logger.success('Reachability analysis completed successfully')

    const reachabilityReport = reachResult.data?.reachabilityReport

    scanPaths = [
      ...excludeFactsJson(packagePaths),
      ...(reachabilityReport ? [reachabilityReport] : []),
    ]

    tier1ReachabilityScanId = reachResult.data?.tier1ReachabilityScanId
  }

  // Run socket-basics comprehensive security scanning if --basics flag is set.
  if (basics) {
    logger.error('')
    logger.info('Starting comprehensive security scan (socket-basics)...')
    debug('notice', 'Socket-basics enabled')

    spinner.start()

    const basicsResult = await runSocketBasics({
      cwd,
      orgSlug,
      repoName,
      spinner,
    })

    spinner.stop()

    if (!basicsResult.ok) {
      logger.warn(
        'Socket-basics scan failed, continuing without SAST/secrets findings',
      )
      debug('error', 'socket-basics error:', basicsResult.message)
    } else {
      logger.success('Comprehensive security scan completed successfully')

      const basicsReport = basicsResult.data?.factsPath

      if (basicsReport && existsSync(basicsReport)) {
        // Add .socket.facts.json from socket-basics to scan paths.
        scanPaths = [...excludeFactsJson(packagePaths), basicsReport]

        const findings = basicsResult.data?.findings || {}
        if (findings.sast) {
          logger.info(`  Found ${findings.sast} SAST issues`)
        }
        if (findings.secrets) {
          logger.info(`  Found ${findings.secrets} exposed secrets`)
        }
        if (findings.containers) {
          logger.info(
            `  Found ${findings.containers} container vulnerabilities`,
          )
        }
      }
    }
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
      scanType: reach.runReachabilityAnalysis
        ? SCAN_TYPE_SOCKET_TIER1
        : SCAN_TYPE_SOCKET,
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
