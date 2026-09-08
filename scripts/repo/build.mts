import {
  runParallelBuilds,
  runSequentialBuilds,
  runSmartBuild,
  runTargetedBuild,
} from './build-steps/build-orchestration.mts'
import { parseArgs } from './build-steps/cli.mts'
import { PLATFORM_TARGETS } from '../../packages/build-infra/lib/platform-targets.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'

export { parseArgs } from './build-steps/cli.mts'
export { showHelp } from './build-steps/cli.mts'
export { buildTarget } from './build-steps/build-targets.mts'

/**
 * Main build function.
 */
async function main(): Promise<void> {
  const opts = parseArgs()

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

const SCRIPT_META: ScriptMeta = {
  describe:
    'comprehensive build script with intelligent caching (CLI package, then SEA binary for the current platform)',
  help: `Usage: node scripts/repo/build.mts [flags]
  (no flags)                       smart build, skips unchanged
  --force                          force rebuild all + SEA for current platform
  --target <name>                  build a specific target
  --targets <t1,t2,...>            build multiple targets
  --platform <p> --arch <a>        build a specific platform/arch
  --platforms                      build all platform binaries
  --platforms --parallel           build platforms in parallel

Platform targets: ${PLATFORM_TARGETS.join(', ')}

Yoga WASM and node-smol binaries are downloaded from socket-btm; all
pre-built binaries are cached in ~/.socket/.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
