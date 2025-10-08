
/**
 * @fileoverview Build the main Socket package
 *
 * This builds the standard Socket CLI package with all features.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getRootPath, log, printFooter, printHeader } from '../utils/common.mjs'
import { runCommand, runSequence } from '../utils/run-command.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const DIST_DIR = join(ROOT_DIR, 'dist')

/**
 * Build the Socket package
 */
export async function buildSocketPackage(options = {}) {
  const { quiet = false, skipClean = false, verbose = false } = options

  if (!quiet) {
    console.log('📦 Building Socket Package')
    console.log('===========================\n')
  }

  const commands = []

  // Clean if needed
  if (!skipClean) {
    commands.push({
      command: 'pnpm',
      args: ['run', 'clean', '--dist', '--quiet']
    })
  }

  // Build with Rollup
  const rollupArgs = [
    'exec', 'rollup',
    '-c', '.config/rollup.dist.config.mjs'
  ]

  if (!verbose) {
    rollupArgs.push('--silent')
  }

  commands.push({
    command: 'pnpm',
    args: rollupArgs
  })

  const exitCode = await runSequence(commands)

  if (exitCode !== 0) {
    if (!quiet) {
      log.failed('Socket package build failed')
    }
    return exitCode
  }

  // Verify output
  if (!existsSync(join(DIST_DIR, 'cli.js'))) {
    if (!quiet) {
      log.failed('Build verification failed: cli.js not found')
    }
    return 1
  }

  if (!quiet) {
    log.success('Socket package built successfully')
    console.log(`   Output: ${DIST_DIR}`)
  }

  return 0
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {
    quiet: args.includes('--quiet'),
    skipClean: args.includes('--skip-clean'),
    verbose: args.includes('--verbose')
  }

  printHeader('Socket Package Build')

  buildSocketPackage(options)
    .then(exitCode => {
      printFooter(exitCode === 0)
      process.exit(exitCode)
    })
    .catch(error => {
      console.error('❌ Build failed:', error.message)
      process.exit(1)
    })
}

export default buildSocketPackage