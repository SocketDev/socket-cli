/**
 * @fileoverview Monorepo-aware dependency update script - checks and updates dependencies.
 * Uses taze to check for updates across all packages in the monorepo.
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

import { runCommand, runParallel } from './utils/run-command.mjs'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const apply = process.argv.includes('--apply')

  try {
    if (!quiet) {
      printHeader('Monorepo Dependency Update')
    }

    // Build taze command with appropriate flags for monorepo.
    const tazeArgs = ['exec', 'taze', '-r']

    if (apply) {
      tazeArgs.push('-w')
      if (!quiet) {
        logger.progress('Updating dependencies across monorepo...')
      }
    } else {
      if (!quiet) {
        logger.progress('Checking for updates across monorepo...')
      }
    }

    // Run taze at root level (recursive flag will check all packages).
    const exitCode = await runCommand('pnpm', tazeArgs, {
      stdio: quiet ? 'pipe' : 'inherit',
    })

    // Clear progress line.
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    // If applying updates, also update Socket packages.
    if (apply && exitCode === 0) {
      if (!quiet) {
        logger.progress('Updating Socket packages...')
      }

      const commands = [
        {
          args: [
            'update',
            '@socketsecurity/*',
            '@socketregistry/*',
            '--latest',
            '-r',
          ],
          command: 'pnpm',
          options: { stdio: quiet ? 'pipe' : 'inherit' },
        },
      ]

      const results = await runParallel(commands)
      const socketExitCode = results[0]

      // Clear progress line.
      if (!quiet) {
        process.stdout.write('\r\x1b[K')
      }

      if (socketExitCode !== 0) {
        if (!quiet) {
          printError('Failed to update Socket packages')
        }
        process.exitCode = 1
        return
      }
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
          printSuccess('Dependencies updated across all packages')
        } else {
          printSuccess('All packages up to date')
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

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
