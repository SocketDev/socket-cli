/**
 * @file Multi-target and smart-build orchestration shared by
 *   scripts/build.mts. Split out of scripts/build.mts to keep each module
 *   under the fleet file-size cap.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import fg from 'fast-glob'

import colors from 'yoctocolors-cjs'

import { CHECKPOINTS } from '../../../packages/build-infra/lib/constants.mts'
import { parsePlatformTarget } from '../../../packages/build-infra/lib/platform-targets.mts'
import { runPipelineCli } from '../../../packages/build-infra/lib/build-pipeline.mts'
import {
  buildCurrentPlatformSea,
  buildPackage,
  buildPlatformSea,
  buildTarget,
} from './build-targets.mts'
import { CLI_BUILD_PACKAGE, TARGET_PACKAGES } from './config.mts'
import type { BuildTargetResult } from './config.mts'
import { logger, rootDir } from './context.mts'

/**
 * Run multiple targeted builds in parallel.
 */
export async function runParallelBuilds(
  targetsToBuild: string[],
  buildArgs: string[],
): Promise<void> {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(
    colors.blue('Building ' + targetsToBuild.length + ' targets in parallel'),
  )
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(`Targets: ${targetsToBuild.join(', ')}`)
  logger.log('')

  // Check if any targets are platform targets that need CLI built first.
  const hasPlatformTargets = targetsToBuild.some(
    t => parsePlatformTarget(t) !== null,
  )
  if (hasPlatformTargets) {
    const cliOutputPath = path.join(rootDir, 'packages/cli/dist/index.js')
    if (!existsSync(cliOutputPath)) {
      logger.log(`${colors.cyan('→')} Building CLI first…`)
      const cliResult = await buildPackage(CLI_BUILD_PACKAGE, {
        force: false,
      })
      if (!cliResult.success) {
        process.exitCode = 1
        return
      }
      logger.log('')
    }
  }

  const startTime = Date.now()
  const results = await Promise.allSettled(
    targetsToBuild.map(target => buildTarget(target, buildArgs)),
  )

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log(colors.blue('Build Summary'))
  logger.log('='.repeat(60))
  logger.log('')

  const successful = results.filter(
    r => r.status === 'fulfilled' && r.value.success,
  ).length
  const failed = results.filter(
    r =>
      r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
  ).length

  logger.log(`${colors.green('Succeeded:')} ${successful}`)
  logger.log(`${colors.red('Failed:')}    ${failed}`)
  logger.log(`${colors.blue('Total:')}     ${totalDuration}s`)
  logger.log('')

  if (failed > 0) {
    logger.log(`${colors.red('✗')} One or more builds failed`)
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`${colors.green('✓')} All builds completed successfully`)
  logger.log('')
}

/**
 * Run multiple targeted builds sequentially.
 */
export async function runSequentialBuilds(
  targetsToBuild: string[],
  buildArgs: string[],
): Promise<void> {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(
    colors.blue('Building ' + targetsToBuild.length + ' targets sequentially'),
  )
  logger.log('='.repeat(60))
  logger.log('')
  logger.log(`Targets: ${targetsToBuild.join(', ')}`)
  logger.log('')

  // Check if any targets are platform targets that need CLI built first.
  const hasPlatformTargets = targetsToBuild.some(
    t => parsePlatformTarget(t) !== null,
  )
  if (hasPlatformTargets) {
    const cliOutputPath = path.join(rootDir, 'packages/cli/dist/index.js')
    if (!existsSync(cliOutputPath)) {
      logger.log(`${colors.cyan('→')} Building CLI first…`)
      const cliResult = await buildPackage(CLI_BUILD_PACKAGE, {
        force: false,
      })
      if (!cliResult.success) {
        process.exitCode = 1
        return
      }
      logger.log('')
    }
  }

  const startTime = Date.now()
  const results: BuildTargetResult[] = []

  for (let i = 0, { length } = targetsToBuild; i < length; i += 1) {
    const target = targetsToBuild[i]
    if (!target) {
      continue
    }
    const result = await buildTarget(target, buildArgs)
    results.push(result)

    if (!result.success) {
      break
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)

  logger.log('')
  logger.log('='.repeat(60))
  logger.log(colors.blue('Build Summary'))
  logger.log('='.repeat(60))
  logger.log('')

  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  logger.log(`${colors.green('Succeeded:')} ${successful}`)
  logger.log(`${colors.red('Failed:')}    ${failed}`)
  logger.log(`${colors.blue('Total:')}     ${totalDuration}s`)
  logger.log('')

  if (failed > 0) {
    logger.log(
      `${colors.red('✗')} Build failed at target: ${results.find(r => !r.success)?.target}`,
    )
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`${colors.green('✓')} All builds completed successfully`)
  logger.log('')
}

/**
 * Run the default smart build — now orchestrated via the shared build-pipeline
 * (same system socket-btm/ultrathink/socket-tui/sdxgen use).
 *
 * Stages: CLI build @socketsecurity/cli via pnpm --filter (the existing
 * buildPackage helper handles signature check + skip-on-cached inside the
 * workspace; the orchestrator's shouldRun layer complements with a
 * content-hashed cache key) SEA build SEA binary for current platform (only
 * when --force/--prod) FINALIZED verify expected outputs exist.
 *
 * Inherits CLI flags from runPipelineCli: --force, --clean, --clean-stage,
 * --from-stage, --cache-key, --prod, --dev.
 */
export async function runSmartBuild(force: boolean): Promise<void> {
  // The orchestrator reads --force/--clean/... off process.argv itself; we
  // only pass `force` here so the SEA stage knows whether to run.
  const cliPkg = CLI_BUILD_PACKAGE
  const cliOutputPath = path.join(rootDir, cliPkg.outputCheck)

  await runPipelineCli({
    packageRoot: rootDir,
    packageName: 'cli',
    resolvePlatformArch: async () => 'universal',
    getBuildPaths: (mode: string) => ({
      buildDir: path.join(rootDir, 'build', mode),
    }),
    getOutputFiles: () => [cliOutputPath],
    stages: [
      {
        name: CHECKPOINTS.CLI,
        sourcePaths: fg.sync(cliPkg.inputs, {
          cwd: rootDir,
          onlyFiles: true,
          dot: true,
          absolute: true,
        }),
        run: async () => {
          const result = await buildPackage(cliPkg, { force })
          if (!result.success) {
            throw new Error(`${cliPkg.name} build failed`)
          }
          return {
            smokeTest: async () => {
              if (!existsSync(cliOutputPath)) {
                throw new Error(`CLI output missing: ${cliOutputPath}`)
              }
            },
          }
        },
      },
      // SEA stage only runs when --force / --prod is set (matches the
      // historical behavior of runSmartBuild — plain `pnpm build` stops
      // after CLI, `pnpm build --force` also builds SEA for the current
      // platform). The skip predicate runs before shouldRun(), so the
      // stage is transparently absent on a normal dev build. Also skipped
      // on CI unless forced: the CI test matrix only consumes the JS
      // bundle, and the SEA asset lookups hit the anonymous GitHub API
      // rate limit on shared runners; release flows dispatch build:sea
      // explicitly.
      {
        name: CHECKPOINTS.SEA,
        skip: ctx =>
          !force && (ctx.buildMode !== 'prod' || !!process.env['CI']),
        // Hash the CLI output into this stage's cache key. Without it,
        // shouldRun() only sees external-tools.json + package.json, so a
        // CLI rebuild that leaves those files untouched would skip SEA
        // and leave a stale binary built against the previous dist/index.js.
        sourcePaths: [cliOutputPath],
        run: async () => {
          const seaResult = await buildCurrentPlatformSea()
          if (!seaResult.success) {
            throw new Error('SEA binary build failed')
          }
          return {}
        },
      },
      {
        name: CHECKPOINTS.FINALIZED,
        run: async () => ({
          smokeTest: async () => {
            if (!existsSync(cliOutputPath)) {
              throw new Error(`CLI output missing: ${cliOutputPath}`)
            }
          },
        }),
      },
    ],
  })
}

/**
 * Run a targeted build for a specific package or platform.
 */
export async function runTargetedBuild(
  target: string,
  buildArgs: string[],
): Promise<void> {
  // Check if this is a platform target (e.g., darwin-arm64).
  const platformInfo = parsePlatformTarget(target)
  if (platformInfo) {
    // Ensure CLI is built first.
    const cliOutputPath = path.join(rootDir, 'packages/cli/dist/index.js')
    if (!existsSync(cliOutputPath)) {
      logger.log(`${colors.cyan('→')} Building CLI first…`)
      const cliResult = await buildPackage(CLI_BUILD_PACKAGE, {
        force: false,
      })
      if (!cliResult.success) {
        process.exitCode = 1
        return
      }
    }

    // Build SEA for the specified platform.
    const result = await buildPlatformSea(
      platformInfo.platform,
      platformInfo.arch,
      platformInfo.libc,
    )
    process.exitCode = result.success ? 0 : 1
    return
  }

  // Not a platform target, use pnpm filter for package builds.
  const packageFilter = TARGET_PACKAGES[target]
  if (!packageFilter) {
    logger.error(`Unknown build target: ${target}`)
    logger.error(
      `Available targets: ${Object.keys(TARGET_PACKAGES).join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  const pnpmArgs = ['--filter', packageFilter, 'run', 'build', ...buildArgs]

  const result = await spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  process.exitCode = result.code ?? 1
}
