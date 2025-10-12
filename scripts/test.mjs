/**
 * @fileoverview Unified test script - runs tests with vitest.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/test.mjs [options] [files...]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 *   --watch    Watch for changes
 *   --ci       Run in CI mode (no watch, coverage enabled)
 */

import {
  isQuiet,
  isVerbose,
  log,
  printError,
  printFooter,
  printHeader,
  printSuccess,
} from './utils/cli-helpers.mjs'
import { runCommand } from './utils/run-command.mjs'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const watch = process.argv.includes('--watch')
  const ci = process.argv.includes('--ci')

  // Extract test files from args (everything that's not a flag)
  const testFiles = process.argv.slice(2).filter(arg => !arg.startsWith('--'))

  try {
    if (!quiet) {
      printHeader('Running Tests')
    }

    // Build vitest command
    const vitestArgs = ['exec', 'vitest']

    if (ci) {
      vitestArgs.push('run', '--coverage')
    } else if (!watch) {
      vitestArgs.push('run')
    }

    // Add test files if specified
    if (testFiles.length > 0) {
      vitestArgs.push(...testFiles)
    }

    // Show progress
    if (!quiet) {
      if (watch) {
        log.info('Starting test watcher...')
      } else {
        log.progress('Running tests...')
      }
    }

    const exitCode = await runCommand('pnpm', vitestArgs, {
      stdio: quiet ? 'pipe' : 'inherit',
    })

    // Clear progress line (not needed in watch mode)
    if (!quiet && !watch) {
      process.stdout.write('\r\x1b[K')
    }

    if (exitCode !== 0) {
      if (!quiet) {
        printError('Tests failed')
      }
      process.exitCode = 1
    } else {
      if (!quiet && !watch) {
        printSuccess('All tests passed')
        printFooter()
      }
    }
  } catch (error) {
    if (!quiet) {
      printError(`Test failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
