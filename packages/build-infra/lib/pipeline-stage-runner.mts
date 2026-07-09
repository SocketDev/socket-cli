/**
 * Single-stage execution for the build-pipeline orchestrator: checkpoint
 * resolution, shouldRun() gating, and createCheckpoint() wrapping. Split out
 * of build-pipeline.mts to keep each module under the fleet file-size cap.
 *
 * @module build-infra/lib/pipeline-stage-runner
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { createCheckpoint, shouldRun } from './checkpoint-manager.mts'
import type { PipelineContext, PipelineStage } from './pipeline-types.mts'

export function resolveCheckpointBuildDir(
  stage: PipelineStage,
  ctx: PipelineContext,
): string {
  if (stage.shared && ctx.sharedPaths?.buildDir) {
    return ctx.sharedPaths.buildDir
  }
  return ctx.paths.buildDir
}

export async function runStage(
  stage: PipelineStage,
  ctx: PipelineContext,
  stageParams: Record<string, unknown>,
): Promise<void> {
  const { buildMode, forceRebuild, logger: stageLogger } = ctx

  if (stage.skipInDev && buildMode === 'dev') {
    stageLogger.substep(`Skipping ${stage.name} (dev build)`)
    return
  }

  if (typeof stage.skip === 'function' && stage.skip(ctx)) {
    stageLogger.substep(`Skipping ${stage.name} (skip predicate)`)
    return
  }

  const buildDir = resolveCheckpointBuildDir(stage, ctx)
  const sourcePaths = [
    path.join(ctx.packageRoot, 'external-tools.json'),
    path.join(ctx.packageRoot, 'package.json'),
    ...(stage.sourcePaths ?? []),
  ].filter(p => existsSync(p))

  const platformMeta = stage.shared
    ? {}
    : {
        buildMode,
        nodeVersion: ctx.nodeVersion,
        platform: process.platform,
        arch: process.arch,
      }

  const shouldProceed = await shouldRun(
    buildDir,
    '',
    stage.name,
    forceRebuild,
    sourcePaths,
    platformMeta,
  )

  if (!shouldProceed) {
    // oxlint-disable-next-line socket/no-status-emoji -- substep takes its own indent prefix; ✓ marks the cache-hit state.
    stageLogger.substep(`✓ ${stage.name} up-to-date (cached)`)
    return
  }

  stageLogger.step(`Running ${stage.name}`)
  const result = (await stage.run(ctx, stageParams)) ?? {}
  const { artifactPath, binaryPath, binarySize, smokeTest } = result
  const runSmokeTest = async (): Promise<void> => {
    if (smokeTest) {
      await smokeTest()
    }
  }

  await createCheckpoint(buildDir, stage.name, runSmokeTest, {
    ...(artifactPath ? { artifactPath } : {}),
    ...(binaryPath ? { binaryPath } : {}),
    ...(binarySize !== undefined ? { binarySize } : {}),
    packageRoot: ctx.packageRoot,
    sourcePaths,
    ...platformMeta,
  })
}
