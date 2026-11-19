import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { applyFullExcludePaths } from './exclude-paths.mts'
import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { finalizeTier1Scan } from './finalize-tier1-scan.mts'
import { outputScanReach } from './output-scan-reach.mts'
import { performReachabilityAnalysis } from './perform-reachability-analysis.mts'
import {
  runDynamicSbomInference,
  withoutDiscardedFacts,
} from './run-dynamic-sbom-inference.mts'
import constants from '../../constants.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { findSocketYmlSync } from '../../utils/config.mts'
import { withTmpDir } from '../../utils/fs.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'
import type {
  DynamicSbomInferenceResult,
  KeptRootsDir,
} from './run-dynamic-sbom-inference.mts'
import type { OutputKind } from '../../types.mts'
import type { FactsOnlyTypes } from '../../utils/coana.mts'

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
  // The ecosystems --dynamic-sbom-inference generates facts for, with the
  // work dir Coana's run reads.
  dsi: { purlTypes: FactsOnlyTypes; workDir: KeptRootsDir } | undefined,
) {
  const { spinner } = constants

  // Extra discovery targets beyond the user's own; the reachability target
  // itself stays `targets[0]`.
  let scanTargets = targets
  let dynamicResult: DynamicSbomInferenceResult | undefined

  if (dsi) {
    logger.info('Generating Socket facts for each build root ...')
    dynamicResult = await runDynamicSbomInference({
      consumer: 'reach',
      context: { coanaVersion: reachabilityOptions.reachVersion, orgSlug },
      cwd,
      excludePaths: reachabilityOptions.excludePaths,
      purlTypes: dsi.purlTypes,
      workDir: dsi.workDir,
    })
    scanTargets = Array.from(
      new Set([...scanTargets, ...dynamicResult.factsPaths]),
    )
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

  const packagePaths = await withoutDiscardedFacts(
    await getPackageFilesForScan(scanTargets, supportedFiles, {
      additionalIgnores: additionalScaIgnores,
      config: socketConfig,
      cwd,
    }),
    dynamicResult?.discardedFactsPaths,
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
    factsOnlyTypes: dynamicResult?.factsOnlyTypes,
    orgSlug,
    outputKind,
    outputPath,
    packagePaths,
    reachabilityOptions: mergedReachabilityOptions,
    socketFactsSidecar: dsi && [...dsi.workDir.entries.values()],
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
  const purlTypes = config.reachabilityOptions.dynamicSbomInference
  // Coana's run reads what facts generation keeps in the work dir.
  return purlTypes
    ? await withTmpDir('socket-dynamic-sbom-inference-', dir =>
        runScanReach(config, {
          purlTypes,
          workDir: { dir, entries: new Map() },
        }),
      )
    : await runScanReach(config, undefined)
}
