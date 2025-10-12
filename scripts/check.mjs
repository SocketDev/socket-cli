/**
 * @fileoverview Unified check script - runs ESLint and TypeScript checks.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/check.mjs [options]
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
import { runCommandQuiet, runParallel } from './utils/run-command.mjs'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()

  try {
    if (!quiet) {
      printHeader('Running Checks')
    }

    // Run ESLint and TypeScript checks in parallel
    const checks = [
      {
        name: 'ESLint',
        command: 'pnpm',
        args: [
          'exec',
          'eslint',
          '--config',
          '.config/eslint.config.mjs',
          '--report-unused-disable-directives',
          '.',
        ],
      },
      {
        name: 'TypeScript',
        command: 'pnpm',
        args: ['exec', 'tsgo', '--noEmit'],
      },
    ]

    // Show progress for each check
    if (!quiet) {
      log.progress('Running ESLint and TypeScript checks...')
    }

    const results = await Promise.all(
      checks.map(async ({ name, command, args }) => {
        const result = await runCommandQuiet(command, args)
        return { name, ...result }
      }),
    )

    // Clear progress line
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    // Check for failures
    const failures = results.filter(r => r.exitCode !== 0)

    if (failures.length > 0) {
      // Show failures
      for (const { name, stdout, stderr } of failures) {
        if (!quiet) {
          log.failed(`${name} check failed`)
        }
        if (verbose || failures.length === 1) {
          if (stdout) {
            console.log(stdout)
          }
          if (stderr) {
            console.error(stderr)
          }
        }
      }

      if (!quiet) {
        printError('Some checks failed')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        printSuccess('All checks passed')
        printFooter()
      }
    }
  } catch (error) {
    if (!quiet) {
      printError(`Check failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
