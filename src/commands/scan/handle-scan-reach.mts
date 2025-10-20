import { logger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'
import { getSpinner } from '@socketsecurity/registry/constants/process'

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
  reachabilityOptions: ReachabilityOptions
  targets: string[]
}

export async function handleScanReach({
  cwd,
  interactive: _interactive,
  orgSlug,
  outputKind,
  reachabilityOptions,
  targets,
}: HandleScanReachConfig) {
  const spinner = getSpinner()!

  // Get supported file names
  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    await outputScanReach(supportedFilesCResult, { cwd, outputKind })
    return
  }

  spinner.start(
    'Searching for local manifest files to include in reachability analysis...',
  )

  const supportedFiles = supportedFilesCResult.data
  const packagePaths = await getPackageFilesForScan(targets, supportedFiles, {
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
    packagePaths,
    reachabilityOptions,
    spinner,
    uploadManifests: true,
  })

  spinner.stop()

  await outputScanReach(result, { cwd, outputKind })
}
