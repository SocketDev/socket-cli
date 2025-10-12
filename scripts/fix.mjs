/**
 * @fileoverview Unified auto-fix script - runs linters with auto-fix enabled.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/fix.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
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

  try {
    if (!quiet) {
      printHeader('Running Auto-fix')
    }

    // Run lint with --fix flag
    const exitCode = await runCommand('pnpm', ['run', 'lint', '--fix'], {
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (exitCode !== 0) {
      if (!quiet) {
        printError('Some fixes could not be applied')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        printSuccess('Linting passed')
        printFooter()
      }
    }
  } catch (error) {
    if (!quiet) {
      printError(`Fix failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
