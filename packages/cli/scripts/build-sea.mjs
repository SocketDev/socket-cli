/**
 * Build Socket SEA (Single Executable Application) binaries.
 * Uses pre-compiled Node.js smol binaries from socket-btm releases.
 *
 * Options:
 *   --platform=<platform> - Build for specific platform (darwin, linux, win32)
 *   --arch=<arch>        - Build for specific architecture (x64, arm64)
 *   --libc=<libc>        - Build for specific libc (musl, glibc) - Linux only
 *   --all                - Build for all platforms (default if no options)
 *
 * Environment:
 *   SOCKET_CLI_SEA_NODE_VERSION - Node.js version to use (default: latest Current)
 *   PREBUILT_NODE_DOWNLOAD_URL  - Binary source (default: 'socket-btm')
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  buildTarget,
  getBuildTargets,
  getDefaultNodeVersion,
} from './sea-build-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const logger = getDefaultLogger()

/**
 * Parse CLI arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    all: args.includes('--all'),
    arch: null,
    libc: null,
    platform: null,
  }

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      options.platform = arg.split('=')[1]
    } else if (arg.startsWith('--arch=')) {
      options.arch = arg.split('=')[1]
    } else if (arg.startsWith('--libc=')) {
      options.libc = arg.split('=')[1]
    }
  }

  // Default to --all if no specific platform/arch/libc specified.
  if (!options.platform && !options.arch && !options.libc) {
    options.all = true
  }

  return options
}

/**
 * Filter targets based on CLI arguments.
 */
function filterTargets(targets, options) {
  if (options.all) {
    return targets
  }

  return targets.filter(target => {
    if (options.platform && target.platform !== options.platform) {
      return false
    }
    if (options.arch && target.arch !== options.arch) {
      return false
    }
    if (options.libc) {
      // Normalize: undefined/null → 'glibc' (default for Linux)
      const targetLibc =
        target.platform === 'linux' && !target.libc ? 'glibc' : target.libc
      if (targetLibc !== options.libc) {
        return false
      }
    }
    return true
  })
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
    process.exit(1)
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
    process.exit(1)
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
    process.exit(1)
  }

  logger.log(
    `Building ${targets.length} target${targets.length > 1 ? 's' : ''}:`,
  )
  for (const target of targets) {
    logger.log(`  - ${target.platform}-${target.arch}`)
  }
  logger.log('')

  // Output directory.
  const outputDir = path.join(rootPath, 'dist/sea')

  // Build all targets in parallel.
  const settled = await Promise.allSettled(
    targets.map(async target => {
      const targetName = `${target.platform}-${target.arch}`
      logger.log(`Building ${targetName}...`)

      const outputPath = await buildTarget(target, entryPoint, { outputDir })
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
