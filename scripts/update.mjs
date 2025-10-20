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

import { isQuiet, isVerbose } from '@socketsecurity/lib/argv/flags'
import { logger } from '@socketsecurity/lib/logger'
import {
  printError,
  printFooter,
  printHeader,
  printSuccess,
} from '@socketsecurity/lib/stdio/header'

import { runParallel } from './utils/run-command.mjs'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const apply = process.argv.includes('--apply')

  try {
    if (!quiet) {
      printHeader('Checking Dependencies')
    }

    // Build taze command with appropriate flags.
    const tazeArgs = ['exec', 'taze']

    if (apply) {
      tazeArgs.push('-w')
      if (!quiet) {
        logger.progress('Updating dependencies...')
      }
    } else {
      if (!quiet) {
        logger.progress('Checking for updates...')
      }
    }

    // Run both taze and Socket package updates in parallel.
    const commands = [
      {
        args: tazeArgs,
        command: 'pnpm',
        options: { stdio: quiet ? 'pipe' : 'inherit' },
      },
    ]

    // Add Socket package update command if applying updates.
    if (apply) {
      commands.push({
        args: [
          'update',
          '@socketsecurity/*',
          '@socketregistry/*',
          '--latest',
          '--no-workspace',
        ],
        command: 'pnpm',
        options: { stdio: quiet ? 'pipe' : 'inherit' },
      })
    }

    const exitCode = await runParallel(commands)

    // Clear progress line.
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    if (exitCode !== 0) {
      if (!quiet) {
        if (apply) {
          printError('Failed to update dependencies')
        } else {
          logger.info('Updates available. Run with --apply to update')
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
