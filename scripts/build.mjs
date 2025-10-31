#!/usr/bin/env node

/**
 * Comprehensive build script with intelligent caching.
 *
 * Builds packages in the correct order:
 * 1. WASM packages (onnxruntime, yoga)
 * 2. CLI package
 * 3. SEA binary
 *
 * Usage:
 *   pnpm run build                    # Smart build (skips unchanged)
 *   pnpm run build --force            # Force rebuild all
 *   pnpm run build --target <name>    # Build specific target
 *   pnpm run build --help             # Show this help
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const TARGET_PACKAGES = {
  __proto__: null,
  all: './packages/**',
  'alpine-arm64': '@socketbin/cli-alpine-arm64',
  'alpine-x64': '@socketbin/cli-alpine-x64',
  bootstrap: '@socketsecurity/bootstrap',
  cli: '@socketsecurity/cli',
  'cli-sentry': '@socketsecurity/cli-with-sentry',
  'darwin-arm64': '@socketbin/cli-darwin-arm64',
  'darwin-x64': '@socketbin/cli-darwin-x64',
  'linux-arm64': '@socketbin/cli-linux-arm64',
  'linux-x64': '@socketbin/cli-linux-x64',
  node: '@socketbin/node-smol-builder-builder',
  sea: '@socketbin/node-sea-builder-builder',
  socket: 'socket',
  'win32-arm64': '@socketbin/cli-win32-arm64',
  'win32-x64': '@socketbin/cli-win32-x64'
}

/**
 * Build configuration for each package in the default build order.
 */
const BUILD_PACKAGES = [
  {
    name: 'ONNX Runtime WASM',
    filter: '@socketsecurity/onnxruntime',
    outputCheck: 'packages/onnxruntime/dist/ort-wasm-simd.wasm',
  },
  {
    name: 'Yoga WASM',
    filter: '@socketsecurity/yoga',
    outputCheck: 'packages/yoga/dist/yoga.wasm',
  },
  {
    name: 'CLI Package',
    filter: '@socketsecurity/cli',
    outputCheck: 'packages/cli/dist/index.js',
  },
  {
    name: 'SEA Binary',
    filter: '@socketbin/node-sea-builder-builder',
    outputCheck: 'packages/socketbin-node-sea-builder-builder/bin/socket',
  },
]

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)
  let target = null
  let force = false
  let help = false
  const buildArgs = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--target' && i + 1 < args.length) {
      target = args[++i]
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      buildArgs.push(arg)
    }
  }

  return { buildArgs, force, help, target }
}

/**
 * Display help message.
 */
function showHelp() {
  logger.log('')
  logger.log(`${colors.blue('Socket CLI Build System')}`)
  logger.log('')
  logger.log('Usage:')
  logger.log('  pnpm run build                    # Smart build (skips unchanged)')
  logger.log('  pnpm run build --force            # Force rebuild all')
  logger.log('  pnpm run build --target <name>    # Build specific target')
  logger.log('  pnpm run build --help             # Show this help')
  logger.log('')
  logger.log('Default Build Order:')
  logger.log('  1. ONNX Runtime WASM (AI features)')
  logger.log('  2. Yoga WASM (terminal layouts)')
  logger.log('  3. CLI Package (TypeScript compilation + bundling)')
  logger.log('  4. SEA Binary (Node.js Single Executable)')
  logger.log('')
  logger.log('Available Targets:')
  for (const target of Object.keys(TARGET_PACKAGES).sort()) {
    logger.log(`  ${target}`)
  }
  logger.log('')
}

/**
 * Check if a package needs to be built.
 * Returns true if build is needed, false if can skip.
 */
function needsBuild(pkg, force) {
  if (force) {
    return true
  }

  const outputPath = path.join(rootDir, pkg.outputCheck)
  if (!existsSync(outputPath)) {
    return true
  }

  // Output exists, can skip.
  return false
}

/**
 * Build a single package.
 */
async function buildPackage(pkg, force) {
  const skip = !needsBuild(pkg, force)

  if (skip) {
    logger.log(`${colors.cyan('→')} ${pkg.name}: ${colors.gray('skipped (up to date)')}`)
    return { success: true, skipped: true }
  }

  logger.log(`${colors.cyan('→')} ${pkg.name}: ${colors.blue('building...')}`)

  const buildScript = force ? 'build:force' : 'build'
  const args = ['--filter', pkg.filter, 'run', buildScript]

  const startTime = Date.now()
  const result = await spawn('pnpm', args, {
    shell: WIN32,
    stdio: 'inherit',
  })
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (result.code !== 0) {
    logger.log(`${colors.red('✗')} ${pkg.name}: ${colors.red('failed')} (${duration}s)`)
    return { success: false, skipped: false }
  }

  logger.log(`${colors.green('✓')} ${pkg.name}: ${colors.green('built')} (${duration}s)`)
  return { success: true, skipped: false }
}

/**
 * Run the default smart build with caching.
 */
async function runSmartBuild(force) {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Socket CLI Build System')}`)
  logger.log('='.repeat(60))
  logger.log('')

  if (force) {
    logger.log(`${colors.yellow('⚠')} Force rebuild enabled (ignoring cache)`)
    logger.log('')
  }

  const results = []
  let totalTime = 0

  for (const pkg of BUILD_PACKAGES) {
    const startTime = Date.now()
    const result = await buildPackage(pkg, force)
    const duration = Date.now() - startTime

    if (!result.skipped) {
      totalTime += duration
    }

    results.push({ ...result, pkg })

    if (!result.success) {
      break
    }
  }

  // Print summary.
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Build Summary')}`)
  logger.log('='.repeat(60))
  logger.log('')

  const built = results.filter(r => r.success && !r.skipped).length
  const skipped = results.filter(r => r.skipped).length
  const failed = results.filter(r => !r.success).length

  logger.log(`${colors.green('Built:')}    ${built}`)
  logger.log(`${colors.gray('Skipped:')}  ${skipped}`)
  if (failed > 0) {
    logger.log(`${colors.red('Failed:')}   ${failed}`)
  }
  logger.log(`${colors.blue('Total:')}    ${(totalTime / 1000).toFixed(1)}s`)
  logger.log('')

  if (failed > 0) {
    logger.log(`${colors.red('✗')} Build FAILED`)
    logger.log('')
    process.exit(1)
  }

  logger.log(`${colors.green('✓')} Build completed successfully`)
  logger.log('')
  process.exit(0)
}

/**
 * Run a targeted build for a specific package.
 */
async function runTargetedBuild(target, buildArgs) {
  const packageFilter = TARGET_PACKAGES[target]
  if (!packageFilter) {
    logger.error(`Unknown build target: ${target}`)
    logger.error(`Available targets: ${Object.keys(TARGET_PACKAGES).join(', ')}`)
    process.exit(1)
  }

  const pnpmArgs = [
    '--filter',
    packageFilter,
    'run',
    'build',
    ...buildArgs
  ]

  const result = await spawn('pnpm', pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  process.exit(result.code ?? 1)
}

/**
 * Main build function.
 */
async function main() {
  const opts = parseArgs()

  if (opts.help) {
    showHelp()
    process.exit(0)
  }

  // If a specific target is specified, use the old behavior.
  if (opts.target) {
    await runTargetedBuild(opts.target, opts.buildArgs)
    return
  }

  // Otherwise, run the smart build with caching.
  await runSmartBuild(opts.force)
}

main().catch(e => {
  logger.error('')
  logger.error(`${colors.red('✗')} Unexpected error: ${e.message}`)
  logger.error('')
  process.exit(1)
})
