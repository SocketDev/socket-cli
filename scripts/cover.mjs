/**
 * @fileoverview Unified coverage script - runs tests with coverage reporting.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/cover.mjs [options]
 *
 * Options:
 *   --quiet      Suppress progress output
 *   --verbose    Show detailed output
 *   --open       Open coverage report in browser
 *   --code-only  Run only code coverage (skip type coverage)
 *   --type-only  Run only type coverage (skip code coverage)
 *   --summary    Show only coverage summary (hide detailed output)
 */

import { isQuiet, isVerbose } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
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

  // Parse custom coverage flags
  const { values } = parseArgs({
    options: {
      'code-only': { type: 'boolean', default: false },
      'type-only': { type: 'boolean', default: false },
      summary: { type: 'boolean', default: false },
    },
    strict: false,
  })

  try {
    if (!quiet) {
      printHeader('Test Coverage')
      console.log('')
    }

    // Run vitest with coverage enabled, capturing output
    // Filter out custom flags that vitest doesn't understand
    const customFlags = ['--code-only', '--type-only', '--summary']
    const vitestArgs = [
      'exec',
      'vitest',
      'run',
      '--coverage',
      ...process.argv.slice(2).filter(arg => !customFlags.includes(arg)),
    ]
    const typeCoverageArgs = ['exec', 'type-coverage']

    let exitCode = 0
    let codeCoverageResult
    let typeCoverageResult

    // Handle --type-only flag
    if (values['type-only']) {
      typeCoverageResult = await runCommandQuiet('pnpm', typeCoverageArgs)
      exitCode = typeCoverageResult.exitCode

      if (!quiet) {
        // Display type coverage only
        const typeCoverageOutput = (
          typeCoverageResult.stdout + typeCoverageResult.stderr
        ).trim()
        const typeCoverageMatch = typeCoverageOutput.match(
          /\([\d\s/]+\)\s+([\d.]+)%/,
        )

        if (typeCoverageMatch) {
          const typeCoveragePercent = Number.parseFloat(typeCoverageMatch[1])
          console.log()
          console.log(' Coverage Summary')
          console.log(' ───────────────────────────────')
          console.log(` Type Coverage: ${typeCoveragePercent.toFixed(2)}%`)
          console.log()
        }
      }

      if (exitCode === 0) {
        if (!quiet) {
          printSuccess('Coverage completed successfully')
        }
      } else {
        if (!quiet) {
          printError('Coverage failed')
        }
        process.exitCode = 1
      }
      return
    }

    // Handle --code-only flag
    if (values['code-only']) {
      codeCoverageResult = await runCommandQuiet('pnpm', vitestArgs)
      exitCode = codeCoverageResult.exitCode

      if (!quiet) {
        // Process code coverage output only
        const ansiRegex = new RegExp(
          `${String.fromCharCode(27)}\\[[0-9;]*m`,
          'g',
        )
        const output = (codeCoverageResult.stdout + codeCoverageResult.stderr)
          .replace(ansiRegex, '')
          .replace(/(?:✧|︎|⚡)\s*/g, '')
          .trim()

        // Extract and display test summary
        const testSummaryMatch = output.match(
          /Test Files\s+\d+[^\n]*\n[\s\S]*?Duration\s+[\d.]+m?s[^\n]*/,
        )
        if (!values.summary && testSummaryMatch) {
          console.log()
          console.log(testSummaryMatch[0])
          console.log()
        }

        // Extract and display coverage summary
        const coverageHeaderMatch = output.match(
          / % Coverage report from v8\n([-|]+)\n([^\n]+)\n\1/,
        )
        const allFilesMatch = output.match(
          /All files\s+\|\s+([\d.]+)\s+\|[^\n]*/,
        )

        if (coverageHeaderMatch && allFilesMatch) {
          if (!values.summary) {
            console.log(' % Coverage report from v8')
            console.log(coverageHeaderMatch[1])
            console.log(coverageHeaderMatch[2])
            console.log(coverageHeaderMatch[1])
            console.log(allFilesMatch[0])
            console.log(coverageHeaderMatch[1])
            console.log()
          }

          const codeCoveragePercent = Number.parseFloat(allFilesMatch[1])
          console.log(' Coverage Summary')
          console.log(' ───────────────────────────────')
          console.log(` Code Coverage: ${codeCoveragePercent.toFixed(2)}%`)
          console.log()
        } else if (exitCode !== 0) {
          console.log('\n--- Output ---')
          console.log(output)
        }
      }

      if (exitCode === 0) {
        if (!quiet) {
          printSuccess('Coverage completed successfully')
        }
      } else {
        if (!quiet) {
          printError('Coverage failed')
        }
        process.exitCode = 1
      }
      return
    }

    // Default: run both code and type coverage
    codeCoverageResult = await runCommandQuiet('pnpm', vitestArgs)
    exitCode = codeCoverageResult.exitCode

    // Run type coverage
    typeCoverageResult = await runCommandQuiet('pnpm', typeCoverageArgs)

    // Combine and clean output - remove ANSI color codes and spinner artifacts
    const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
    const output = (codeCoverageResult.stdout + codeCoverageResult.stderr)
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
      if (!values.summary && testSummaryMatch) {
        console.log()
        console.log(testSummaryMatch[0])
        console.log()
      }

      if (coverageHeaderMatch && allFilesMatch) {
        if (!values.summary) {
          console.log(' % Coverage report from v8')
          console.log(coverageHeaderMatch[1]) // Top border
          console.log(coverageHeaderMatch[2]) // Header row
          console.log(coverageHeaderMatch[1]) // Middle border
          console.log(allFilesMatch[0]) // All files row
          console.log(coverageHeaderMatch[1]) // Bottom border
          console.log()
        }

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

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
