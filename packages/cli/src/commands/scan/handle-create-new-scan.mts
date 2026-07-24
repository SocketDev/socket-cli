import { existsSync } from 'node:fs'
import path from 'node:path'

import { debugDir, debugNs } from '@socketsecurity/lib-stable/debug/output'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

const logger = getDefaultLogger()

import { applyFullExcludePaths } from './exclude-paths.mts'
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
import { runSocketBasics } from '../../util/basics/spawn.mts'

/**
 * Filter out .socket.facts.json files from scan paths to avoid duplicates.
 *
 * @param paths - Array of file paths to filter.
 *
 * @returns Filtered paths without .socket.facts.json files.
 */
export function excludeFactsJson(paths: string[]): string[] {
  return paths.filter(p => path.basename(p) !== DOT_SOCKET_DOT_FACTS_JSON)
}
import { compressSocketFactsForUpload } from '../../util/coana/compress-facts.mts'
import { findSocketYmlSync } from '../../util/config.mts'
import { getPackageFilesForScan } from '../../util/fs/path-resolve.mts'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'
import { socketDocsLink } from '../../util/terminal/link.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { REPORT_LEVEL } from './types.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/lib-stable/objects/types'

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
  workspace?: string | undefined
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
  workspace,
}: HandleCreateNewScanConfig): Promise<void> {
  debugNs(
    'notice',
    `Creating new scan for ${orgSlug}/${workspace ? `${workspace}/` : ''}${repoName}`,
  )
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
    workspace,
  })

  if (autoManifest) {
    logger.info('Auto-generating manifest files ...')
    debugNs('notice', 'Auto-manifest mode enabled')
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

  const supportedFilesCResult = await fetchSupportedScanFileNames({
    orgSlug,
    spinner,
  })
  if (!supportedFilesCResult.ok) {
    debugNs('warn', 'Failed to fetch supported scan file names')
    debugDir('inspect', { supportedFilesCResult })
    await outputCreateNewScan(supportedFilesCResult, {
      interactive,
      outputKind,
    })
    return
  }
  debugNs(
    'notice',
    `Fetched supported file types for ${Object.keys(supportedFilesCResult.data).length} ecosystems`,
  )

  spinner.start('Searching for local files to include in scan…')

  const supportedFiles = supportedFilesCResult.data

  // Load socket.yml so projectIgnorePaths is respected when collecting files.
  const socketYmlResult = findSocketYmlSync(cwd)
  const socketConfig = socketYmlResult.ok
    ? socketYmlResult.data?.parsed
    : undefined

  const { effectiveSocketConfig, mergedReachabilityOptions } =
    applyFullExcludePaths({
      cwd,
      reachabilityOptions: reach,
      socketConfig,
      target: targets[0]!,
    })

  const packagePaths = await getPackageFilesForScan(targets, supportedFiles, {
    config: effectiveSocketConfig,
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
    debugNs('warn', 'No eligible files found to scan')
    return
  }

  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', { count: packagePaths.length })}`,
  )

  debugDir('inspect', { packagePaths })

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    debugNs('notice', 'Read-only mode, exiting early')
    return
  }

  let scanPaths: string[] = packagePaths
  let tier1ReachabilityScanId: string | undefined
  let reachabilityReport: string | undefined
  // Whether this run generated the .socket.facts.json itself. We only clean
  // up a facts file we produced — a pre-existing one (the user pre-generated
  // it, or --reach-use-only-pregenerated-sboms points at their own artifacts)
  // is left untouched.
  let generatedFactsFile = false

  // If reachability is enabled, perform reachability analysis.
  if (reach.runReachabilityAnalysis) {
    /* c8 ignore start - defensive: empty targets crashes earlier at applyFullExcludePaths({ target: targets[0]! }) — this guard is unreachable in practice. */
    if (!targets.length) {
      logger.fail('Reachability analysis requires at least one target')
      return
    }
    /* c8 ignore stop */

    const [firstTarget] = targets
    if (!firstTarget) {
      logger.fail('Reachability analysis requires at least one valid target')
      return
    }

    logger.error('')
    logger.info('Starting reachability analysis…')
    debugNs('notice', 'Reachability analysis enabled')
    debugDir('inspect', { reachabilityOptions: mergedReachabilityOptions })

    // Record whether the facts file was already on disk before the analysis
    // ran. The create flow always writes coana's report to the default
    // .socket.facts.json in cwd, so a file present now was not produced by
    // this run and must be preserved. --reach-use-only-pregenerated-sboms
    // likewise signals the user is managing their own artifacts.
    const factsFilePreExisted = existsSync(
      path.resolve(cwd, DOT_SOCKET_DOT_FACTS_JSON),
    )

    spinner.start()

    const reachResult = await performReachabilityAnalysis({
      branchName,
      cwd,
      orgSlug,
      packagePaths,
      reachabilityOptions: mergedReachabilityOptions,
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

    reachabilityReport = reachResult.data?.reachabilityReport
    generatedFactsFile =
      !factsFilePreExisted && !reach.reachUseOnlyPregeneratedSboms

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
    debugNs('notice', 'Socket-basics enabled')

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
      debugNs('error', 'socket-basics error:', basicsResult.message)
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

  // Brotli-compress any .socket.facts.json paths in scanPaths just before
  // upload. depscan's api-v0 multipart boundary streams brotli decode based
  // on the .br filename suffix. Coana keeps writing plain .socket.facts.json
  // on disk, so the local read path (extractTier1ReachabilityScanId) stays
  // correct. The cleanup() in the finally block removes the sibling .br
  // files whether the upload succeeded or threw.
  const compressed = await compressSocketFactsForUpload(scanPaths)
  let fullScanCResult: Awaited<ReturnType<typeof fetchCreateOrgFullScan>>
  try {
    fullScanCResult = await fetchCreateOrgFullScan(
      compressed.paths,
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
        workspace,
      },
      {
        cwd,
        defaultBranch,
        pendingHead,
        tmp,
      },
    )
  } finally {
    await compressed.cleanup()
  }

  const scanId = fullScanCResult.ok ? fullScanCResult.data?.id : undefined

  if (reach && scanId && tier1ReachabilityScanId) {
    await finalizeTier1Scan(tier1ReachabilityScanId, scanId)
  }

  if (fullScanCResult.ok && reachabilityReport && generatedFactsFile) {
    // The facts file is an upload artifact, not user-facing output — remove
    // it once the scan is submitted so it doesn't linger in the project. Only
    // a file we generated this run is removed; a pre-existing or
    // user-pre-generated facts file is left in place (see generatedFactsFile).
    // On submission failure we intentionally keep the file for debuggability.
    await safeDelete(path.resolve(cwd, reachabilityReport), { force: true })
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
