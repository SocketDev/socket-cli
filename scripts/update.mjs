/**
 * @fileoverview Unified dependency update script - checks and updates dependencies.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/update.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 *   --apply    Apply updates (default is check-only)
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
  const apply = process.argv.includes('--apply')

  try {
    if (!quiet) {
      printHeader('Checking Dependencies')
    }

    // Build taze command with appropriate flags
    const tazeArgs = ['exec', 'taze']

    if (apply) {
      tazeArgs.push('-w')
      if (!quiet) {
        log.progress('Updating dependencies...')
      }
    } else {
      if (!quiet) {
        log.progress('Checking for updates...')
      }
    }

    // Run taze command
    const exitCode = await runCommand('pnpm', tazeArgs, {
      stdio: quiet ? 'pipe' : 'inherit',
    })

    // Clear progress line
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    if (exitCode !== 0) {
      if (!quiet) {
        if (apply) {
          printError('Failed to update dependencies')
        } else {
          log.info('Updates available. Run with --apply to update')
        }
      }
      process.exitCode = apply ? 1 : 0
    } else {
      if (!quiet) {
        if (apply) {
          printSuccess('Dependencies updated')
        } else {
          printSuccess('Dependencies up to date')
        }
        printFooter()
      }
    }
  } catch (error) {
    if (!quiet) {
      printError(`Update failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
