import { unlink } from 'node:fs/promises'
import path from 'node:path'

import micromatch from 'micromatch'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { applyFullExcludePaths } from './exclude-paths.mts'
import { fetchCreateOrgFullScan } from './fetch-create-org-full-scan.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { handleScanReport } from './handle-scan-report.mts'
import { outputCreateNewScan } from './output-create-new-scan.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import constants from '../../constants.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { compressSocketFactsForUpload } from '../../utils/coana.mts'
import { findSocketYmlSync } from '../../utils/config.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'
import { socketDocsLink } from '../../utils/terminal-link.mts'
import { detectManifestActions } from '../manifest/detect-manifest-actions.mts'
import { generateAutoManifest } from '../manifest/generate_auto_manifest.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { REPORT_LEVEL } from './types.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

// Keys for CDX and SPDX in the supported files response.
const CDX_SPDX_KEYS = ['cdx', 'spdx']

function getCdxSpdxPatterns(
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
): string[] {
  const patterns: string[] = []
  for (const key of CDX_SPDX_KEYS) {
    const supported = supportedFiles[key]
    if (supported) {
      for (const entry of Object.values(supported)) {
        patterns.push(`**/${entry.pattern}`)
      }
    }
  }
  return patterns
}

function filterToCdxSpdxOnly(
  filepaths: string[],
  supportedFiles: SocketSdkSuccessResult<'getReportSupportedFiles'>['data'],
): string[] {
  const patterns = getCdxSpdxPatterns(supportedFiles)
  return filepaths.filter(filepath =>
    micromatch.some(filepath, patterns, { nocase: true }),
  )
}

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
  workspace?: string | undefined
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
  workspace,
}: HandleCreateNewScanConfig): Promise<void> {
  let scanTargets = targets

  debugFn(
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
    debugFn('notice', 'Auto-manifest mode enabled')
    const sockJson = readOrDefaultSocketJson(cwd)
    const detected = await detectManifestActions(sockJson, cwd)
    debugDir('inspect', { detected })
    const autoManifestResult = await generateAutoManifest({
      detected,
      cwd,
      outputKind,
      verbose: false,
    })
    if (autoManifestResult.generatedFiles.length) {
      scanTargets = Array.from(
        new Set([...targets, ...autoManifestResult.generatedFiles]),
      )
    }
    logger.info('Auto-generation finished. Proceeding with Scan creation.')
  }

  const { spinner } = constants

  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    debugFn('warn', 'Failed to fetch supported scan file names')
    debugDir('inspect', { supportedFilesCResult })
    await outputCreateNewScan(supportedFilesCResult, {
      interactive,
      outputKind,
    })
    return
  }
  debugFn(
    'notice',
    `Fetched ${supportedFilesCResult.data['size']} supported file types`,
  )

  spinner.start('Searching for local files to include in scan...')

  const supportedFiles = supportedFilesCResult.data

  // Load socket.yml to respect projectIgnorePaths when collecting files.
  const socketYmlResult = findSocketYmlSync(cwd)
  const socketConfig = socketYmlResult.ok
    ? socketYmlResult.data?.parsed
    : undefined

  const { additionalScaIgnores, mergedReachabilityOptions } =
    applyFullExcludePaths({
      cwd,
      reachabilityOptions: reach,
      target: targets[0]!,
    })

  const packagePaths = await getPackageFilesForScan(
    scanTargets,
    supportedFiles,
    {
      additionalIgnores: additionalScaIgnores,
      config: socketConfig,
      cwd,
    },
  )

  spinner.successAndStop(
    `Found ${packagePaths.length} ${pluralize('file', packagePaths.length)} to include in scan.`,
  )

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: packagePaths.length > 0,
    fail: `found no eligible files to scan. See supported manifest files at ${socketDocsLink('/docs/manifest-file-detection-in-socket', 'docs.socket.dev')}`,
    message:
      'TARGET (file/dir) must contain matching / supported file types for a scan',
  })
  if (!wasValidInput) {
    debugFn('warn', 'No eligible files found to scan')
    return
  }

  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', packagePaths.length)}`,
  )

  debugDir('inspect', { packagePaths })

  if (readOnly) {
    logger.log('[ReadOnly] Bailing now')
    debugFn('notice', 'Read-only mode, exiting early')
    return
  }

  let scanPaths: string[] = packagePaths
  let tier1ReachabilityScanId: string | undefined
  let reachabilityReport: string | undefined

  // If reachability is enabled, perform reachability analysis.
  if (reach.runReachabilityAnalysis) {
    logger.error('')
    logger.info('Starting reachability analysis...')
    debugFn('notice', 'Reachability analysis enabled')
    debugDir('inspect', { reachabilityOptions: mergedReachabilityOptions })

    spinner.start()

    const reachResult = await performReachabilityAnalysis({
      branchName,
      cwd,
      orgSlug,
      packagePaths,
      reachabilityOptions: mergedReachabilityOptions,
      repoName,
      spinner,
      target: targets[0]!,
    })

    spinner.stop()

    if (!reachResult.ok) {
      await outputCreateNewScan(reachResult, { interactive, outputKind })
      return
    }

    logger.success('Reachability analysis completed successfully')

    reachabilityReport = reachResult.data?.reachabilityReport

    // Ensure the .socket.facts.json isn't duplicated in case it happened
    // to be in the scan folder before the analysis was run.
    const filteredPackagePaths = packagePaths.filter(
      p => path.basename(p) !== constants.DOT_SOCKET_DOT_FACTS_JSON,
    )

    // When using pregenerated SBOMs only, filter to CDX/SPDX files.
    const pathsForScan = reach.reachUseOnlyPregeneratedSboms
      ? filterToCdxSpdxOnly(filteredPackagePaths, supportedFiles)
      : filteredPackagePaths

    scanPaths = [
      ...pathsForScan,
      ...(reachabilityReport ? [reachabilityReport] : []),
    ]

    tier1ReachabilityScanId = reachResult.data?.tier1ReachabilityScanId
  }

  // Brotli-compress any .socket.facts.json paths in scanPaths just before
  // upload. depscan's api-v0 multipart boundary streams brotli decode based
  // on the .br filename suffix. Coana keeps writing plain .socket.facts.json
  // on disk, so the local read paths (extractTier1ReachabilityScanId,
  // extractReachabilityErrors) stay correct. The cleanup() in the finally
  // block removes the temp dirs whether the upload succeeded or threw.
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
          ? constants.SCAN_TYPE_SOCKET_TIER1
          : constants.SCAN_TYPE_SOCKET,
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

  // On a successful scan, clean up the `.socket.facts.json` coana wrote at
  // the path we instructed it to write to (via `--socket-mode`). Failed
  // scans leave the file in place for debugging. Producer-written files
  // (e.g. from `socket manifest gradle --facts`) are NOT touched here —
  // those are user-owned input that the user can clean up themselves; in
  // the --reach path coana overwrites that file with its enriched output
  // anyway, so it's the same path that gets removed.
  if (fullScanCResult.ok && scanId && reachabilityReport) {
    try {
      await unlink(path.resolve(cwd, reachabilityReport))
      debugFn(
        'notice',
        `[socket-facts] removed coana output after successful scan: ${reachabilityReport}`,
      )
    } catch {
      // Best-effort — file may already be gone or unwritable.
    }
  }

  if (report && fullScanCResult.ok) {
    if (scanId) {
      await handleScanReport({
        filepath: '-',
        fold: constants.FOLD_SETTING_VERSION,
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
