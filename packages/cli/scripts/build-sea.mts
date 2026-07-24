/**
 * Build Socket SEA (Single Executable Application) binaries. Uses the frozen
 * pre-compiled node-smol base binaries mirrored into socket-cli base-assets-*
 * releases (SHA-256 pinned in constants/base-assets.mts, with a transition
 * fallback to the descoped socket-btm source releases).
 *
 * Options: --target=<target> - Build for specific target (darwin-arm64,
 * linux-x64-musl, etc.) --platform=<platform> - Build for specific platform
 * (darwin, linux, win32) --arch=<arch> - Build for specific architecture (x64,
 * arm64) --libc=<libc> - Build for specific libc (musl, glibc) - Linux only
 * --all - Build for all platforms (default if no options)
 *
 * Environment: SOCKET_CLI_SEA_NODE_VERSION - Node.js version to use (default:
 * the frozen base pinned in constants/base-assets.mts)
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { parsePlatformArgs } from 'build-infra/lib/platform-targets'
import { tripletFromParts } from 'package-builder/scripts/cli-exe-targets.mts'
import { getCliExeBinaryPath } from 'package-builder/scripts/paths.mts'

import { buildTarget } from './sea-build-utils/orchestration.mts'
import {
  getBuildTargets,
  getDefaultNodeVersion,
} from './sea-build-utils/targets.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Filter targets based on CLI arguments.
 */
function filterTargets(targets, config) {
  const cfg = { __proto__: null, ...config }
  if (cfg.all) {
    return targets
  }

  return targets.filter(target => {
    if (cfg.platform && target.platform !== cfg.platform) {
      return false
    }
    if (cfg.arch && target.arch !== cfg.arch) {
      return false
    }
    if (cfg.libc) {
      // Normalize: undefined/null → 'glibc' (default for Linux)
      const targetLibc =
        target.platform === 'linux' && !target.libc ? 'glibc' : target.libc
      if (targetLibc !== cfg.libc) {
        return false
      }
    }
    return true
  })
}

/**
 * Parse CLI arguments.
 */
export function parseArgs() {
  const args = process.argv.slice(2)
  const platformArgs = parsePlatformArgs(args)

  const options = {
    all: args.includes('--all'),
    arch: platformArgs.arch,
    libc: platformArgs.libc,
    platform: platformArgs.platform,
  }

  // Default to --all if no specific platform/arch/libc specified.
  if (!options.platform && !options.arch && !options.libc) {
    options.all = true
  }

  return options
}

/**
 * Main build logic.
 */
async function main() {
  const options = parseArgs()

  // Validate libc is Linux-only
  if (options.libc && options.platform && options.platform !== 'linux') {
    logger.fail('Error: --libc parameter is only valid for Linux builds')
    logger.fail(
      `Specified: --platform=${options.platform} --libc=${options.libc}`,
    )
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log('')
  logger.log('Socket SEA Builder')
  logger.log('='.repeat(50))
  logger.log('')

  // Verify CLI bundle exists.
  const entryPoint = path.join(rootPath, 'build/cli.js')
  if (!existsSync(entryPoint)) {
    logger.fail('CLI bundle not found: build/cli.js')
    logger.log('')
    logger.log('Run build first:')
    logger.log('  pnpm --filter @socketsecurity/cli run build')
    logger.log('')
    process.exitCode = 1
    return
  }

  // Get Node.js version.
  const nodeVersion = await getDefaultNodeVersion()
  logger.log(`Node.js version: ${nodeVersion}`)
  logger.log('')

  // Get and filter build targets.
  const allTargets = await getBuildTargets()
  const targets = filterTargets(allTargets, options)

  if (targets.length === 0) {
    logger.fail('No targets match the specified criteria')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(
    `Building ${targets.length} target${targets.length > 1 ? 's' : ''}:`,
  )
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]
    logger.log(`  - ${target.platform}-${target.arch}`)
  }
  logger.log('')

  // Build all targets in parallel.
  // Output goes directly into the @socketsecurity/cli.exe.<triplet> tail
  // package directories, under bin/.
  const settled = await Promise.allSettled(
    targets.map(async target => {
      const targetName = `${target.platform}-${target.arch}${target.libc ? `-${target.libc}` : ''}`
      logger.log(`Building ${targetName}...`)

      // Get output path from the cli.exe tail package directory.
      const triplet = tripletFromParts(
        target.platform,
        target.arch,
        target.libc,
      )
      if (!triplet) {
        throw new Error(`No cli.exe triplet for target ${targetName}`)
      }
      const outputPath = getCliExeBinaryPath(triplet)

      await buildTarget(target, entryPoint, { outputPath })
      logger.success(
        `✓ ${targetName} -> ${path.relative(rootPath, outputPath)}`,
      )
      return { outputPath, success: true, target }
    }),
  )

  // Process results from Promise.allSettled.
  const results = settled.map(result => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const target = result.reason?.target || {}
    const targetName = `${target.platform || 'unknown'}-${target.arch || 'unknown'}`
    logger.fail(
      `${targetName} failed: ${result.reason?.message || result.reason}`,
    )
    return {
      error: result.reason?.message || String(result.reason),
      success: false,
      target,
    }
  })

  logger.log('')

  // Summary.
  logger.log('='.repeat(50))
  logger.log('')

  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  if (failed === 0) {
    logger.success(`All ${successful} builds completed successfully`)
  } else {
    logger.fail(`${failed} build${failed > 1 ? 's' : ''} failed`)
    process.exitCode = 1
  }

  logger.log('')
}

main().catch(e => {
  logger.error('SEA build failed:', e)
  process.exitCode = 1
})
