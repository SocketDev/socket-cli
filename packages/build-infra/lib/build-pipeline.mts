/**
 * WASM build pipeline orchestrator.
 *
 * Declarative orchestrator for wasm-shipping packages. Given a manifest of
 * ordered stages, it drives the canonical sequence: clone source → configure →
 * compile → release → (optimize) → sync → finalize.
 *
 * The orchestrator owns every moving part that today lives in each package's
 * 340-line build.mts:
 *
 * - Build mode + platform-arch detection (uses centralized helpers).
 * - Loading external-tools.json + package.json `sources` metadata.
 * - Deriving a unified cache key from: node version, platform, arch, build mode,
 *   pinned tool versions, and source refs. Tool bump or source SHA bump
 *   invalidates the cache automatically — no hand-wired busting.
 * - Per-stage shouldRun() / createCheckpoint() wrapping. Stages become pure work
 *   functions; they do not implement skip-if-cached themselves.
 * - Common CLI flags: --prod / --dev / --force / --clean / --clean-stage=<name> /
 *   --from-stage=<name> / --cache-key.
 *
 * A stage is `(ctx, params) => Promise<void>`. `ctx` carries derived values
 * shared by every stage (paths, mode, logger, tool versions, source meta).
 * `params` holds stage-local overrides from the manifest.
 *
 * @module build-infra/lib/build-pipeline
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { cleanCheckpoint } from './checkpoint-manager.mts'
import { getBuildMode, validateCheckpointChain } from './constants.mts'
import { getCurrentPlatformArch } from './platform-mappings.mts'
import {
  buildCacheKey,
  hashFileContents,
  loadExternalTools,
  loadPackageJson,
  parseFlags,
} from './pipeline-cache.mts'
import {
  resolveCheckpointBuildDir,
  runStage,
} from './pipeline-stage-runner.mts'
import type {
  ParsedFlags,
  PipelineContext,
  RunPipelineOptions,
  SharedBuildPaths,
  SourceMap,
} from './pipeline-types.mts'
import { getNodeVersion } from './version-helpers.mts'

export {
  buildCacheKey,
  hashFileContents,
  loadExternalTools,
  loadPackageJson,
  parseFlags,
  readJson,
} from './pipeline-cache.mts'
export {
  resolveCheckpointBuildDir,
  runStage,
} from './pipeline-stage-runner.mts'

const logger = getDefaultLogger()

/**
 * Validate + run a pipeline. On --cache-key, prints the key and exits without
 * building. Returns the context so the caller can render a summary.
 */
export async function runPipeline(
  options: RunPipelineOptions,
  cliOverrides?: ParsedFlags | undefined,
): Promise<PipelineContext | undefined> {
  const {
    extraCacheInputs = [],
    getBuildPaths,
    getOutputFiles,
    getSharedBuildPaths,
    packageName,
    packageRoot,
    preflight,
    resolvePlatformArch,
    stages,
  } = { __proto__: null, ...options } as typeof options

  const flags = cliOverrides ?? parseFlags(process.argv.slice(2))
  const buildMode = getBuildMode(flags.raw ?? new Set())
  const platformArch = resolvePlatformArch
    ? await resolvePlatformArch()
    : await getCurrentPlatformArch()
  const nodeVersion = getNodeVersion().replace(/^v/, '')

  const [pkgJson, { versions: toolVersions, rawHash: toolsHash }] =
    await Promise.all([
      loadPackageJson(packageRoot),
      loadExternalTools(packageRoot),
    ])

  const sources: SourceMap = pkgJson.sources ?? {}
  const packageVersion = pkgJson.version ?? '0.0.0'

  const extraHash =
    extraCacheInputs.length > 0 ? hashFileContents(extraCacheInputs) : ''
  const cacheKey = buildCacheKey({
    buildMode,
    extraHash,
    nodeVersion,
    packageVersion,
    platformArch,
    sources,
    toolsHash,
    toolVersions,
  })

  if (flags.printCacheKey) {
    process.stdout.write(`${cacheKey}\n`) // socket-hook: allow console
    return undefined
  }

  const paths = getBuildPaths(buildMode, platformArch)
  const sharedPaths: SharedBuildPaths | undefined = getSharedBuildPaths
    ? getSharedBuildPaths()
    : undefined
  const outputFiles = getOutputFiles ? getOutputFiles(paths) : []

  // Validate chain for typos / unknown names.
  validateCheckpointChain(
    stages.map(s => s.name),
    packageName,
  )

  const ctx: PipelineContext = {
    buildMode,
    cacheKey,
    forceRebuild: flags.force,
    logger,
    nodeVersion,
    packageName,
    packageRoot,
    paths,
    platformArch,
    sharedPaths,
    sources,
    toolVersions,
  }

  const totalStart = Date.now()
  logger.step(`🔨 Building ${packageName}`)
  logger.info(`Mode: ${buildMode}`)
  logger.info(`Platform: ${platformArch}`)
  logger.info(`Cache key: ${cacheKey}`)
  logger.info('')

  // Handle --clean / --clean-stage / missing-output clean-up.
  if (flags.clean) {
    logger.substep('Clean build requested — removing all checkpoints')
    await cleanCheckpoint(paths.buildDir, '')
    if (sharedPaths?.buildDir) {
      await cleanCheckpoint(sharedPaths.buildDir, '')
    }
  } else if (flags.cleanStage) {
    logger.substep(`Clean requested for stage: ${flags.cleanStage}`)
    // Invalidates this stage + anything depending on it.
    const idx = stages.findIndex(s => s.name === flags.cleanStage)
    if (idx === -1) {
      throw new Error(
        `Unknown --clean-stage=${flags.cleanStage}. Valid: ${stages.map(s => s.name).join(', ')}`,
      )
    }
    for (const stage of stages.slice(idx)) {
      const buildDir = resolveCheckpointBuildDir(stage, ctx)
      const markerDir = path.join(buildDir, 'checkpoints')
      for (const ext of ['.json', '.tar.gz', '.tar.gz.lock']) {
        const file = path.join(markerDir, `${stage.name}${ext}`)
        if (existsSync(file)) {
          await safeDelete(file)
        }
      }
    }
  } else if (outputFiles.length && outputFiles.some(p => !existsSync(p))) {
    logger.substep(
      'Output artifacts missing — invalidating all checkpoints to rebuild',
    )
    await cleanCheckpoint(paths.buildDir, '')
    if (sharedPaths?.buildDir) {
      await cleanCheckpoint(sharedPaths.buildDir, '')
    }
  }

  if (preflight) {
    logger.step('Pre-flight Checks')
    await preflight()
    logger.success('Pre-flight checks passed')
  }

  // --from-stage: pretend earlier stages succeeded (they should have cached
  // checkpoints already). We just skip running them.
  let startIdx = 0
  if (flags.fromStage) {
    startIdx = stages.findIndex(s => s.name === flags.fromStage)
    if (startIdx === -1) {
      throw new Error(
        `Unknown --from-stage=${flags.fromStage}. Valid: ${stages.map(s => s.name).join(', ')}`,
      )
    }
    logger.substep(`Starting from stage: ${flags.fromStage}`)
  }

  for (const stage of stages.slice(startIdx)) {
    await runStage(stage, ctx, {})
  }

  const seconds = ((Date.now() - totalStart) / 1000).toFixed(1)
  logger.step('🎉 Build Complete!')
  logger.success(`Total time: ${seconds}s`)
  logger.success(`Output: ${paths.outputFinalDir ?? paths.buildDir}`)
  if (outputFiles.length) {
    logger.info('')
    logger.info('Files:')
    for (const file of outputFiles) {
      logger.info(`  - ${path.relative(packageRoot, file)}`)
    }
    logger.info('')
  }
  return ctx
}

/**
 * CLI entry-point helper. Wraps runPipeline with a top-level error handler.
 */
export async function runPipelineCli(
  options: RunPipelineOptions,
): Promise<void> {
  try {
    await runPipeline(options)
  } catch (e) {
    // Set exit code and rethrow so the caller's top-level handler is the
    // single place that formats/logs the failure. Logging here AND in the
    // caller's catch shows the same error twice.
    process.exitCode = 1
    throw e
  }
}
