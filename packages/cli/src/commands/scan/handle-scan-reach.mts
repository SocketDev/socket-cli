import { getDefaultSpinner } from '@socketsecurity/lib/spinner'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { outputScanReach } from './output-scan-reach.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import { getPackageFilesForScan } from '../../utils/fs/path-resolve.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { OutputKind } from '../../types.mts'

export type HandleScanReachConfig = {
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
  const supportedFilesCResult = await fetchSupportedScanFileNames({
    spinner: spinner ?? undefined,
  })
  if (!supportedFilesCResult.ok) {
    await outputScanReach(supportedFilesCResult, {
      cwd,
      outputKind,
      outputPath,
    })
    return
  }

  spinner?.start(
    'Searching for local manifest files to include in reachability analysis...',
  )

  const supportedFiles = supportedFilesCResult.data
  const packagePaths = await getPackageFilesForScan(targets, supportedFiles, {
    cwd,
  })

  spinner?.successAndStop(
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

  const logger = getDefaultLogger()
  logger.success(
    `Found ${packagePaths.length} local ${pluralize('file', { count: packagePaths.length })}`,
  )

  spinner?.start('Running reachability analysis...')

  const result = await performReachabilityAnalysis({
    cwd,
    orgSlug,
    outputPath,
    packagePaths,
    reachabilityOptions,
    spinner: spinner ?? undefined,
    target: targets[0]!,
    uploadManifests: true,
  })

  spinner?.stop()

  await outputScanReach(result, { cwd, outputKind, outputPath })
}
