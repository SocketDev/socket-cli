/** @fileoverview Utility to generate and calculate code coverage metrics. */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Simple JSON file reader
const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'))

// Simple object check
const isObjectObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Count how many items in array are covered (greater than 0).
 */
function countCovered(counts) {
  return counts.filter(count => count > 0).length
}

/**
 * Get code coverage metrics from c8 coverage data.
 * @throws {Error} When coverage generation fails or data is invalid.
 */
export async function getCodeCoverage(options) {
  const { generateIfMissing = true } = { __proto__: null, ...options }

  const coverageJsonPath = path.join(
    process.cwd(),
    'coverage',
    'coverage-final.json',
  )

  if (!existsSync(coverageJsonPath)) {
    if (!generateIfMissing) {
      return null
    }

    const exitCode = await new Promise((resolve) => {
      const child = spawn('pnpm', ['run', 'test', '--coverage'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
      })
      child.on('exit', (code) => resolve(code || 0))
      child.on('error', () => resolve(1))
    })

    if (exitCode !== 0) {
      throw new Error(
        `Failed to generate coverage data: exit code ${exitCode}`,
      )
    }
  }

  let coverageData
  try {
    coverageData = readJson(coverageJsonPath)
  } catch {
    coverageData = null
  }
  if (!isObjectObject(coverageData)) {
    throw new Error('Error reading coverage data')
  }

  let coveredBranches = 0
  let coveredFunctions = 0
  let coveredLines = 0
  let coveredStatements = 0
  let totalBranches = 0
  let totalFunctions = 0
  let totalLines = 0
  let totalStatements = 0

  for (const coverage of Object.values(coverageData)) {
    // Statements.
    coveredStatements += countCovered(Object.values(coverage.s))
    totalStatements += Object.keys(coverage.s).length

    // Branches.
    for (const branchId in coverage.b) {
      const branches = coverage.b[branchId]
      coveredBranches += countCovered(branches)
      totalBranches += branches.length
    }

    // Functions.
    coveredFunctions += countCovered(Object.values(coverage.f))
    totalFunctions += Object.keys(coverage.f).length

    // Lines (using statement map for line coverage).
    const linesCovered = new Set()
    const linesTotal = new Set()
    for (const stmtId in coverage.statementMap) {
      const stmt = coverage.statementMap[stmtId]
      const line = stmt.start.line
      linesTotal.add(line)
      if (coverage.s[stmtId] > 0) {
        linesCovered.add(line)
      }
    }
    coveredLines += linesCovered.size
    totalLines += linesTotal.size
  }

  const stmtPercent =
    totalStatements > 0
      ? ((coveredStatements / totalStatements) * 100).toFixed(2)
      : '0.00'
  const branchPercent =
    totalBranches > 0
      ? ((coveredBranches / totalBranches) * 100).toFixed(2)
      : '0.00'
  const funcPercent =
    totalFunctions > 0
      ? ((coveredFunctions / totalFunctions) * 100).toFixed(2)
      : '0.00'
  const linePercent =
    totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(2) : '0.00'

  return {
    statements: {
      percent: stmtPercent,
      covered: coveredStatements,
      total: totalStatements,
    },
    branches: {
      percent: branchPercent,
      covered: coveredBranches,
      total: totalBranches,
    },
    functions: {
      percent: funcPercent,
      covered: coveredFunctions,
      total: totalFunctions,
    },
    lines: {
      percent: linePercent,
      covered: coveredLines,
      total: totalLines,
    },
  }
}
