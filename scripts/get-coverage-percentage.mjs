/** @fileoverview Display combined code and type coverage percentages with color formatting. */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

import { getCodeCoverage } from './utils/get-code-coverage.mjs'
import { getTypeCoverage } from './utils/get-type-coverage.mjs'

const indent = '  '

/**
 * Logs coverage percentage data including code and type coverage metrics.
 * Supports multiple output formats: default (formatted), JSON, and simple.
 */
async function logCoveragePercentage(argv) {
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
      console.log('Generating coverage data...')
    } else {
      console.log('Reading coverage data...')
    }

    codeCoverage = await getCodeCoverage()
  } catch (error) {
    console.error('Failed to get code coverage:', error.message)
    throw error
  }

  // Get type coverage (optional - if it fails, we continue without it).
  let typeCoveragePercent = null
  try {
    typeCoveragePercent = await getTypeCoverage()
  } catch (error) {
    console.error('Failed to get type coverage:', error.message)
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
    console.log(`Coverage Summary:`)
    console.log(
      `${indent}Statements: ${codeCoverage.statements.percent}% (${codeCoverage.statements.covered}/${codeCoverage.statements.total})`,
    )
    console.log(
      `${indent}Branches:   ${codeCoverage.branches.percent}% (${codeCoverage.branches.covered}/${codeCoverage.branches.total})`,
    )
    console.log(
      `${indent}Functions:  ${codeCoverage.functions.percent}% (${codeCoverage.functions.covered}/${codeCoverage.functions.total})`,
    )
    console.log(
      `${indent}Lines:      ${codeCoverage.lines.percent}% (${codeCoverage.lines.covered}/${codeCoverage.lines.total})`,
    )

    if (typeCoveragePercent !== null) {
      console.log(`${indent}Types:      ${typeCoveragePercent.toFixed(2)}%`)
    }

    console.log('')
    console.log(colors.bold(`Current coverage: ${overall}% overall!${emoji}`))
  }
}

// Main entry point - parse command line arguments and display coverage.
void (async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: {
        type: 'boolean',
        // -j for JSON output.
        short: 'j',
      },
      simple: {
        type: 'boolean',
        // -s for simple output.
        short: 's',
      },
    },
  })
  await logCoveragePercentage(values)
})()
