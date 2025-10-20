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

import { isQuiet, isVerbose } from '@socketsecurity/lib/argv/flags'
import { logger } from '@socketsecurity/lib/logger'

import { runCommandQuiet } from './utils/run-command.mjs'

/**
 * Print a header message.
 */
function printHeader(message) {
  logger.error('\n═══════════════════════════════════════════════════════')
  logger.error(`  ${message}`)
  logger.error('═══════════════════════════════════════════════════════\n')
}

/**
 * Print a success message.
 */
function printSuccess(message) {
  logger.log(`✔ ${message}`)
}

/**
 * Print an error message.
 */
function printError(message) {
  logger.error(`✖ ${message}`)
}

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const open = process.argv.includes('--open')

  try {
    if (!quiet) {
      printHeader('Running Coverage')
    }

    // Run vitest with coverage enabled, capturing output
    const vitestArgs = ['exec', 'vitest', 'run', '--coverage']
    const typeCoverageArgs = ['exec', 'type-coverage']

    const { exitCode, stderr, stdout } = await runCommandQuiet(
      'pnpm',
      vitestArgs,
    )

    // Run type coverage
    const typeCoverageResult = await runCommandQuiet('pnpm', typeCoverageArgs)

    // Combine and clean output - remove ANSI color codes and spinner artifacts
    const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
    const output = (stdout + stderr)
      .replace(ansiRegex, '') // Remove ANSI color codes
      .replace(/(?:✧|︎|⚡)\s*/g, '') // Remove spinner artifacts
      .trim()

    // Extract test summary (Test Files ... Duration)
    const testSummaryMatch = output.match(
      /Test Files\s+\d+[^\n]*\n[\s\S]*?Duration\s+[\d.]+m?s[^\n]*/,
    )

    // Extract coverage summary: header + All files row
    // Match from "% Coverage" header through the All files line and closing border
    const coverageHeaderMatch = output.match(
      / % Coverage report from v8\n([-|]+)\n([^\n]+)\n\1/,
    )
    const allFilesMatch = output.match(/All files\s+\|\s+([\d.]+)\s+\|[^\n]*/)

    // Extract type coverage percentage
    const typeCoverageOutput = (
      typeCoverageResult.stdout + typeCoverageResult.stderr
    ).trim()
    const typeCoverageMatch = typeCoverageOutput.match(
      /\([\d\s/]+\)\s+([\d.]+)%/,
    )

    // Display clean output
    if (!quiet) {
      if (testSummaryMatch) {
        console.log()
        console.log(testSummaryMatch[0])
        console.log()
      }

      if (coverageHeaderMatch && allFilesMatch) {
        console.log(' % Coverage report from v8')
        console.log(coverageHeaderMatch[1]) // Top border
        console.log(coverageHeaderMatch[2]) // Header row
        console.log(coverageHeaderMatch[1]) // Middle border
        console.log(allFilesMatch[0]) // All files row
        console.log(coverageHeaderMatch[1]) // Bottom border
        console.log()

        // Display type coverage and cumulative summary
        if (typeCoverageMatch) {
          const codeCoveragePercent = Number.parseFloat(allFilesMatch[1])
          const typeCoveragePercent = Number.parseFloat(typeCoverageMatch[1])
          const cumulativePercent = (
            (codeCoveragePercent + typeCoveragePercent) /
            2
          ).toFixed(2)

          console.log(' Coverage Summary')
          console.log(' ───────────────────────────────')
          console.log(` Type Coverage: ${typeCoveragePercent.toFixed(2)}%`)
          console.log(` Code Coverage: ${codeCoveragePercent.toFixed(2)}%`)
          console.log(' ───────────────────────────────')
          console.log(` Cumulative:    ${cumulativePercent}%`)
          console.log()
        }
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        printError('Coverage failed')
        // Show relevant output on failure for debugging
        if (!testSummaryMatch && !coverageHeaderMatch) {
          console.log('\n--- Output ---')
          console.log(output)
        }
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        printSuccess('Coverage completed successfully')

        // Open coverage report if requested
        if (open) {
          const { runCommand } = await import('./utils/run-command.mjs')
          logger.info('Opening coverage report...')
          await runCommand('open', ['coverage/index.html'], {
            stdio: 'ignore',
          })
        }
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
