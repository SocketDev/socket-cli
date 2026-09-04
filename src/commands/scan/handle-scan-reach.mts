import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { applyFullExcludePaths } from './exclude-paths.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { outputScanReach } from './output-scan-reach.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import { runDynamicSbomInference } from './run-dynamic-sbom-inference.mts'
import constants from '../../constants.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { findSocketYmlSync } from '../../utils/config.mts'
import { withTmpDir } from '../../utils/fs.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type { OutputKind } from '../../types.mts'
import type { ResolvedPathsSidecar } from '../manifest/scripts/sidecar.mts'

export type HandleScanReachConfig = {
  cwd: string
  interactive: boolean
  orgSlug: string
  outputKind: OutputKind
  outputPath: string
  reachabilityOptions: ReachabilityOptions
  targets: string[]
}

async function runScanReach(
  {
    cwd,
    interactive: _interactive,
    orgSlug,
    outputKind,
    outputPath,
    reachabilityOptions,
    targets,
  }: HandleScanReachConfig,
  sbtTmpDir: string | undefined,
) {
  const { spinner } = constants

  // Extra discovery targets beyond the user's own; the reachability target
  // itself stays `targets[0]`.
  let scanTargets = targets
  // Sidecar forwarded to reachability; populated by dynamic SBOM inference.
  let resolvedPathsSidecar: ResolvedPathsSidecar | undefined

  if (reachabilityOptions.dynamicSbomInference) {
    logger.info(
      'Generating Socket facts for each Gradle, sbt, and Maven build root ...',
    )
    const dynamicResult = await runDynamicSbomInference({
      cwd,
      excludePaths: reachabilityOptions.excludePaths,
      sbtTmpDir,
      withFiles: true,
    })
    scanTargets = Array.from(
      new Set([...scanTargets, ...dynamicResult.factsPaths]),
    )
    resolvedPathsSidecar = dynamicResult.resolvedPathsSidecar
  }

  // Get supported file names.
  const supportedFilesCResult = await fetchSupportedScanFileNames({
    orgSlug,
    spinner,
  })
  if (!supportedFilesCResult.ok) {
    await outputScanReach(supportedFilesCResult, {
      cwd,
      outputKind,
      outputPath,
    })
    return
  }

  spinner.start(
    'Searching for local manifest files to include in reachability analysis...',
  )

  const supportedFiles = supportedFilesCResult.data

  // Load socket.yml to respect projectIgnorePaths when collecting files.
  const socketYmlResult = findSocketYmlSync(cwd)
  const socketConfig = socketYmlResult.ok
    ? socketYmlResult.data?.parsed
    : undefined

  const { additionalScaIgnores, mergedReachabilityOptions } =
    applyFullExcludePaths({
      cwd,
      reachabilityOptions,
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
    `Found ${packagePaths.length} ${pluralize('manifest file', packagePaths.length)} for reachability analysis.`,
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
    `Found ${packagePaths.length} local ${pluralize('file', packagePaths.length)}`,
  )

  spinner.start('Running reachability analysis...')

  const result = await performReachabilityAnalysis({
    cwd,
    orgSlug,
    outputKind,
    outputPath,
    packagePaths,
    reachabilityOptions: mergedReachabilityOptions,
    resolvedPathsSidecar,
    spinner,
    target: targets[0]!,
  })

  spinner.stop()

  // Standalone reachability has no full scan to bind to, but the full
  // application reachability scan row still needs to transition to its DONE
  // terminal state — otherwise it sits at the post-Coana intermediate state forever
  // and looks indistinguishable from a stuck run. Pass `null` as the full
  // scan id; the endpoint accepts it for this flow. Best-effort: never
  // block the user-visible output on this.
  const tier1Id = result.ok ? result.data?.tier1ReachabilityScanId : undefined
  if (tier1Id) {
    const finalizeResult = await finalizeTier1Scan(tier1Id, null)
    if (!finalizeResult.ok) {
      logger.warn(
        `Failed to finalize full application reachability scan: ${finalizeResult.message}${finalizeResult.cause ? ` — ${finalizeResult.cause}` : ''}`,
      )
    }
  }

  await outputScanReach(result, { cwd, outputKind, outputPath })
}

export async function handleScanReach(
  config: HandleScanReachConfig,
): Promise<void> {
  // sbt provisions its Scala toolchain under the directory passed as its
  // isolated global base; the sidecar's artifactPaths point into it, so it
  // must stay on disk until the reachability analysis has consumed them.
  return config.reachabilityOptions.dynamicSbomInference
    ? await withTmpDir('socket-dynamic-sbom-inference-', tmpDir =>
        runScanReach(config, tmpDir),
      )
    : await runScanReach(config, undefined)
}
