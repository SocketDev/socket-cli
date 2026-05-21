import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/registry'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

const logger = getDefaultLogger()

import { applyFullExcludePaths } from './exclude-paths.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { outputScanReach } from './output-scan-reach.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import { findSocketYmlSync } from '../../util/config.mts'
import { getPackageFilesForScan } from '../../util/fs/path-resolve.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { OutputKind } from '../../types.mts'

type HandleScanReachConfig = {
  cwd: string
  interactive: boolean
  orgSlug: string
  outputKind: OutputKind
  outputPath: string
  reachabilityOptions: ReachabilityOptions
  targets: string[]
}

export async function handleScanReach({
  cwd,
  interactive: _interactive,
  orgSlug,
  outputKind,
  outputPath,
  reachabilityOptions,
  targets,
}: HandleScanReachConfig) {
  const spinner = getDefaultSpinner()

  // Get supported file names
  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    await outputScanReach(supportedFilesCResult, {
      outputKind,
      outputPath: '',
    })
    return
  }

  spinner.start(
    'Searching for local manifest files to include in reachability analysis...',
  )

  const supportedFiles = supportedFilesCResult.data

  // Load socket.yml so projectIgnorePaths is respected when collecting files.
  const socketYmlResult = findSocketYmlSync(cwd)
  const socketConfig = socketYmlResult.ok
    ? socketYmlResult.data?.parsed
    : undefined

  const { effectiveSocketConfig, mergedReachabilityOptions } =
    applyFullExcludePaths({
      cwd,
      reachabilityOptions,
      socketConfig,
      target: targets[0]!,
    })

  const packagePaths = await getPackageFilesForScan(targets, supportedFiles, {
    config: effectiveSocketConfig,
    cwd,
  })

  spinner.successAndStop(
    `Found ${packagePaths.length} ${pluralize('manifest file', { count: packagePaths.length })} for reachability analysis.`,
  )

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: packagePaths.length > 0,
    fail: 'found no eligible files to analyze',
    message:
      'TARGET (file/dir) must contain matching / supported file types for reachability analysis',
  })
  if (!wasValidInput) {
    return
  }

  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', { count: packagePaths.length })}`,
  )

  spinner.start('Running reachability analysis...')

  const result = await performReachabilityAnalysis({
    cwd,
    orgSlug,
    outputPath,
    packagePaths,
    reachabilityOptions: mergedReachabilityOptions,
    spinner,
    target: targets[0]!,
    uploadManifests: true,
  })

  spinner.stop()

  const resolvedOutputPath = result.ok ? result.data.reachabilityReport : ''
  await outputScanReach(result, {
    outputKind,
    outputPath: resolvedOutputPath || outputPath,
  })
}
