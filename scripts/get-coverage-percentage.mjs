import { existsSync } from 'node:fs'
import path from 'node:path'

import yargsParser from 'yargs-parser'
import colors from 'yoctocolors-cjs'

import constants from '@socketsecurity/registry/lib/constants'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getCodeCoverage } from './utils/get-code-coverage.mjs'
import { getTypeCoverage } from './utils/get-type-coverage.mjs'

const indent = '  '

/**
 * Logs coverage percentage data including code and type coverage metrics.
 * Supports multiple output formats: default (formatted), JSON, and simple.
 */
async function logCoveragePercentage(argv) {
  const { spinner } = constants

  // Check if coverage data exists to determine whether to generate or read it.
  const coverageJsonPath = path.join(
    process.cwd(),
    'coverage',
    'coverage-final.json',
  )

  // Get code coverage metrics (statements, branches, functions, lines).
  let codeCoverage
  try {
    if (!existsSync(coverageJsonPath)) {
      spinner.start('Generating coverage data...')
    } else {
      spinner.start('Reading coverage data...')
    }

    codeCoverage = await getCodeCoverage()

    spinner.stop()
  } catch (error) {
    spinner.stop()
    logger.error('Failed to get code coverage:', error.message)
    throw error
  }

  // Get type coverage (optional - if it fails, we continue without it).
  let typeCoveragePercent = null
  try {
    typeCoveragePercent = await getTypeCoverage()
  } catch (error) {
    logger.error('Failed to get type coverage:', error.message)
    // Continue without type coverage - it's not critical.
  }

  // Calculate overall percentage (average of all metrics including type coverage if available).
  const codeCoverageMetrics = [
    parseFloat(codeCoverage.statements.percent),
    parseFloat(codeCoverage.branches.percent),
    parseFloat(codeCoverage.functions.percent),
    parseFloat(codeCoverage.lines.percent),
  ]

  let overall
  if (typeCoveragePercent !== null) {
    // Include type coverage in the overall calculation.
    const allMetrics = [...codeCoverageMetrics, typeCoveragePercent]
    overall = (
      allMetrics.reduce((a, b) => a + b, 0) / allMetrics.length
    ).toFixed(2)
  } else {
    // Fallback to just code coverage metrics when type coverage is unavailable.
    overall = (
      codeCoverageMetrics.reduce((a, b) => a + b, 0) /
      codeCoverageMetrics.length
    ).toFixed(2)
  }

  // Select an emoji based on overall coverage percentage for visual feedback.
  const overallNum = parseFloat(overall)
  let emoji = ''
  if (overallNum >= 99) {
    // Excellent coverage.
    emoji = ' 🚀'
  } else if (overallNum >= 95) {
    // Great coverage.
    emoji = ' 🎯'
  } else if (overallNum >= 90) {
    // Very good coverage.
    emoji = ' ✨'
  } else if (overallNum >= 80) {
    // Good coverage.
    emoji = ' 💪'
  } else if (overallNum >= 70) {
    // Decent coverage.
    emoji = ' 📈'
  } else if (overallNum >= 60) {
    // Fair coverage.
    emoji = ' ⚡'
  } else if (overallNum >= 50) {
    // Needs improvement.
    emoji = ' 🔨'
  } else {
    // Low coverage warning.
    emoji = ' ⚠️'
  }

  // Output the coverage data in the requested format.
  if (argv.json) {
    // JSON format: structured output for programmatic consumption.
    const jsonOutput = {
      statements: codeCoverage.statements,
      branches: codeCoverage.branches,
      functions: codeCoverage.functions,
      lines: codeCoverage.lines,
    }

    if (typeCoveragePercent !== null) {
      jsonOutput.types = {
        percent: typeCoveragePercent.toFixed(2),
      }
    }

    jsonOutput.overall = overall

    console.log(JSON.stringify(jsonOutput, null, 2))
  } else if (argv.simple) {
    // Simple format: just the statement coverage percentage.
    console.log(codeCoverage.statements.percent)
  } else {
    // Default format: human-readable formatted output.
    logger.info(`Coverage Summary:`)
    logger.info(
      `${indent}Statements: ${codeCoverage.statements.percent}% (${codeCoverage.statements.covered}/${codeCoverage.statements.total})`,
    )
    logger.info(
      `${indent}Branches:   ${codeCoverage.branches.percent}% (${codeCoverage.branches.covered}/${codeCoverage.branches.total})`,
    )
    logger.info(
      `${indent}Functions:  ${codeCoverage.functions.percent}% (${codeCoverage.functions.covered}/${codeCoverage.functions.total})`,
    )
    logger.info(
      `${indent}Lines:      ${codeCoverage.lines.percent}% (${codeCoverage.lines.covered}/${codeCoverage.lines.total})`,
    )

    if (typeCoveragePercent !== null) {
      logger.info(`${indent}Types:      ${typeCoveragePercent.toFixed(2)}%`)
    }

    logger.info('')
    logger.info(colors.bold(`Current coverage: ${overall}% overall!${emoji}`))
  }
}

// Main entry point - parse command line arguments and display coverage.
void (async () => {
  const argv = yargsParser(process.argv.slice(2), {
    boolean: ['json', 'simple'],
    alias: {
      // -j for JSON output.
      j: 'json',
      // -s for simple output.
      s: 'simple',
    },
  })
  await logCoveragePercentage(argv)
})()
