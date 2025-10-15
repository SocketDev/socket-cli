/**
 * @fileoverview Unified coverage script - runs tests with coverage reporting.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/cover.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 *   --open     Open coverage report in browser
 */

import { isQuiet, isVerbose } from '@socketsecurity/registry/lib/argv/flags'
import { logger } from '@socketsecurity/registry/lib/logger'
import {
  printError,
  printFooter,
  printHeader,
  printSuccess,
} from '@socketsecurity/registry/lib/stdio/header'

import { runCommand } from './utils/run-command.mjs'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const open = process.argv.includes('--open')

  try {
    if (!quiet) {
      printHeader('Running Coverage')
    }

    // Show progress
    if (!quiet) {
      logger.progress('Collecting coverage...')
    }

    // Run vitest coverage command
    const vitestArgs = ['run', 'coverage']

    // Add coverage reporter options
    if (open) {
      vitestArgs.push('--reporter=html')
    }

    const exitCode = await runCommand(
      'pnpm',
      ['exec', 'vitest', ...vitestArgs],
      {
        stdio: quiet ? 'pipe' : 'inherit',
      },
    )

    // Clear progress line
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    if (exitCode !== 0) {
      if (!quiet) {
        printError('Coverage failed')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        printSuccess('Coverage complete')

        // Open coverage report if requested
        if (open) {
          logger.info('Opening coverage report...')
          await runCommand('open', ['coverage/index.html'], {
            stdio: 'ignore',
          })
        }

        printFooter()
      }
    }
  } catch (error) {
    if (!quiet) {
      printError(`Coverage failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
