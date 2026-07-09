/**
 * @file CLI argument parsing + help text for scripts/build.mts. Split out of
 *   scripts/build.mts to keep each module under the fleet file-size cap.
 */

import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { PLATFORM_TARGETS } from '../../packages/build-infra/lib/platform-targets.mts'
import { TARGET_PACKAGES } from './config.mts'
import type { ParsedArgs } from './config.mts'
import { logger } from './context.mts'

/**
 * Parse command line arguments.
 */
export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  let target: string | undefined
  let targets: string[] = []
  let platforms = false
  let parallel = false
  let force = false
  let help = false
  let platform: string | undefined
  let arch: string | undefined
  const buildArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--target' && i + 1 < args.length) {
      target = args[++i]
    } else if (arg === '--targets' && i + 1 < args.length) {
      targets = args[++i]!.split(',').map(t => t.trim())
    } else if (arg === '--platform' && i + 1 < args.length) {
      platform = args[++i]
    } else if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1]
    } else if (arg === '--arch' && i + 1 < args.length) {
      arch = args[++i]
    } else if (arg.startsWith('--arch=')) {
      arch = arg.split('=')[1]
    } else if (arg === '--platforms') {
      platforms = true
    } else if (arg === '--parallel') {
      parallel = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      buildArgs.push(arg)
    }
  }

  // If --platform and --arch are provided, combine them into target.
  if (platform && arch) {
    target = `${platform}-${arch}`
  }

  return {
    arch,
    buildArgs,
    force,
    help,
    parallel,
    platform,
    platforms,
    target,
    targets,
  }
}

/**
 * Display help message.
 */
export function showHelp(): void {
  logger.log('')
  logger.log(`${colors.blue('Socket CLI Build System')}`)
  logger.log('')
  logger.log('Usage:')
  logger.log(
    '  pnpm run build                           # Smart build (skips unchanged)',
  )
  logger.log(
    '  pnpm run build --force                   # Force rebuild all + SEA for current platform',
  )
  logger.log(
    '  pnpm run build:sea                       # Build SEA binaries for all platforms',
  )
  logger.log(
    '  pnpm run build --target <name>           # Build specific target',
  )
  logger.log(
    '  pnpm run build --platform <p> --arch <a> # Build specific platform/arch',
  )
  logger.log(
    '  pnpm run build --targets <t1,t2,...>     # Build multiple targets',
  )
  logger.log(
    '  pnpm run build --platforms               # Build all platform binaries',
  )
  logger.log(
    '  pnpm run build --platforms --parallel    # Build platforms in parallel',
  )
  logger.log('  pnpm run build --help                    # Show this help')
  logger.log('')
  logger.log('Default Build Order:')
  logger.log('  1. CLI Package (TypeScript compilation + bundling)')
  logger.log('  2. SEA Binary for current platform (only with --force)')
  logger.log('')
  logger.log(
    'Note: Yoga WASM and node-smol binaries are downloaded from socket-btm',
  )
  logger.log('      All pre-built binaries are cached in ~/.socket/ directory')
  logger.log('')
  logger.log('Platform Targets:')
  for (const target of PLATFORM_TARGETS) {
    logger.log(`  ${target}`)
  }
  logger.log('')
  logger.log('Other Available Targets:')
  const otherTargets = Object.keys(TARGET_PACKAGES).toSorted()
  for (let i = 0, { length } = otherTargets; i < length; i += 1) {
    const target = otherTargets[i]!
    if (!PLATFORM_TARGETS.includes(target)) {
      logger.log(`  ${target}`)
    }
  }
  logger.log('')
}
