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
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

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
      logger.log('')
    }

    // Run vitest with coverage enabled, capturing output
    // Filter out custom flags that vitest doesn't understand
    const customFlags = ['--code-only', '--type-only', '--summary']
    const vitestArgs = [
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--passWithNoTests',
      ...process.argv.slice(2).filter(arg => !customFlags.includes(arg)),
    ]
    const typeCoverageArgs = ['exec', 'type-coverage']

    let exitCode = 0
    let codeCoverageResult
    let typeCoverageResult

    // Handle --type-only flag
    if (values['type-only']) {
      typeCoverageResult = await spawn('pnpm', typeCoverageArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: WIN32,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      exitCode = typeCoverageResult.code

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
          logger.log('')
          logger.log(' Coverage Summary')
          logger.log(' ───────────────────────────────')
          logger.log(` Type Coverage: ${typeCoveragePercent.toFixed(2)}%`)
          logger.log('')
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
      codeCoverageResult = await spawn('pnpm', vitestArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: WIN32,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      exitCode = codeCoverageResult.code

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
          logger.log('')
          logger.log(testSummaryMatch[0])
          logger.log('')
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
            logger.log(' % Coverage report from v8')
            logger.log(coverageHeaderMatch[1])
            logger.log(coverageHeaderMatch[2])
            logger.log(coverageHeaderMatch[1])
            logger.log(allFilesMatch[0])
            logger.log(coverageHeaderMatch[1])
            logger.log('')
          }

          const codeCoveragePercent = Number.parseFloat(allFilesMatch[1])
          logger.log(' Coverage Summary')
          logger.log(' ───────────────────────────────')
          logger.log(` Code Coverage: ${codeCoveragePercent.toFixed(2)}%`)
          logger.log('')
        } else if (exitCode !== 0) {
          logger.log('\n--- Output ---')
          logger.log(output)
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
    codeCoverageResult = await spawn('pnpm', vitestArgs, {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: WIN32,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    exitCode = codeCoverageResult.code

    // Run type coverage
    typeCoverageResult = await spawn('pnpm', typeCoverageArgs, {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: WIN32,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Combine and clean output - remove ANSI color codes and spinner artifacts
    const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
    const output = (codeCoverageResult.stdout + codeCoverageResult.stderr)
      // Remove ANSI color codes
      .replace(ansiRegex, '')
      // Remove spinner artifacts
      .replace(/(?:✧|︎|⚡)\s*/g, '')
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
        logger.log('')
        logger.log(testSummaryMatch[0])
        logger.log('')
      }

      if (coverageHeaderMatch && allFilesMatch) {
        if (!values.summary) {
          logger.log(' % Coverage report from v8')
          // Top border
          logger.log(coverageHeaderMatch[1])
          // Header row
          logger.log(coverageHeaderMatch[2])
          // Middle border
          logger.log(coverageHeaderMatch[1])
          // All files row
          logger.log(allFilesMatch[0])
          // Bottom border
          logger.log(coverageHeaderMatch[1])
          logger.log('')
        }

        // Display type coverage and cumulative summary
        if (typeCoverageMatch) {
          const codeCoveragePercent = Number.parseFloat(allFilesMatch[1])
          const typeCoveragePercent = Number.parseFloat(typeCoverageMatch[1])
          const cumulativePercent = (
            (codeCoveragePercent + typeCoveragePercent) /
            2
          ).toFixed(2)

          logger.log(' Coverage Summary')
          logger.log(' ───────────────────────────────')
          logger.log(` Type Coverage: ${typeCoveragePercent.toFixed(2)}%`)
          logger.log(` Code Coverage: ${codeCoveragePercent.toFixed(2)}%`)
          logger.log(' ───────────────────────────────')
          logger.log(` Cumulative:    ${cumulativePercent}%`)
          logger.log('')
        }
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        printError('Coverage failed')
        // Show relevant output on failure for debugging
        if (!testSummaryMatch && !coverageHeaderMatch) {
          logger.log('\n--- Output ---')
          logger.log(output)
        }
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        printSuccess('Coverage completed successfully')

        // Open coverage report if requested
        if (open) {
          logger.info('Opening coverage report...')
          await spawn('open', ['coverage/index.html'], {
            shell: WIN32,
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
      logger.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
