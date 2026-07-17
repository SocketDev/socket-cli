/*
 * Comprehensive build script with intelligent caching.
 *
 * Builds packages in the correct order:
 *
 * 1. CLI package (TypeScript compilation and bundling)
 * 2. SEA binary for current platform (only with --force)
 *
 * Note: Yoga WASM and node-smol binaries are downloaded from socket-btm during
 * CLI build.
 *
 * Usage: pnpm run build # Smart build (skips unchanged) pnpm run build --force.
 *
 * # Force rebuild all + SEA for current platform pnpm run build:sea # Build SEA
 *
 * Binaries for all platforms pnpm run build --target <name> # Build specific
 * target pnpm run build --targets <t1,t2,...> # Build multiple targets pnpm run
 * build --platforms # Build all platform binaries pnpm run build --platforms
 * --parallel # Build platforms in parallel pnpm run build --help # Show this
 * help.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import colors from 'yoctocolors-cjs'

import {
  runParallelBuilds,
  runSequentialBuilds,
  runSmartBuild,
  runTargetedBuild,
} from './build-steps/build-orchestration.mts'
import { parseArgs, showHelp } from './build-steps/cli.mts'
import { logger } from './build-steps/context.mts'
import { PLATFORM_TARGETS } from '../../packages/build-infra/lib/platform-targets.mts'

export { parseArgs } from './build-steps/cli.mts'
export { showHelp } from './build-steps/cli.mts'
export { buildTarget } from './build-steps/build-targets.mts'

/**
 * Main build function.
 */
async function main(): Promise<void> {
  const opts = parseArgs()

  if (opts.help) {
    showHelp()
    return
  }

  // Handle platforms build.
  if (opts.platforms) {
    const buildFn = opts.parallel ? runParallelBuilds : runSequentialBuilds
    await buildFn(PLATFORM_TARGETS, opts.buildArgs)
    return
  }

  // Handle multiple targets.
  if (opts.targets.length > 0) {
    const buildFn = opts.parallel ? runParallelBuilds : runSequentialBuilds
    await buildFn(opts.targets, opts.buildArgs)
    return
  }

  // Handle single target.
  if (opts.target) {
    await runTargetedBuild(opts.target, opts.buildArgs)
    return
  }

  // Otherwise, run the smart build with caching.
  await runSmartBuild(opts.force)
}

main().catch((e: unknown) => {
  const message = errorMessage(e)
  logger.error('')
  logger.error(`${colors.red('✗')} Unexpected error: ${message}`)
  logger.error('')
  process.exitCode = 1
})
