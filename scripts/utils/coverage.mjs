/**
 * @fileoverview Coverage utilities for code and type coverage.
 * Consolidates coverage calculation functions.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Simple helpers
const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'))
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
export async function getCodeCoverage(options = {}) {
  const { generateIfMissing = true } = options

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

  // Process each file in the coverage data
  for (const fileData of Object.values(coverageData)) {
    // Skip if not a valid coverage object
    if (!isObjectObject(fileData) || !isObjectObject(fileData.s)) {
      continue
    }

    // Statements
    const statementCounts = Object.values(fileData.s)
    coveredStatements += countCovered(statementCounts)
    totalStatements += statementCounts.length

    // Branches
    if (isObjectObject(fileData.b)) {
      const branchArrays = Object.values(fileData.b)
      for (const branches of branchArrays) {
        if (Array.isArray(branches)) {
          for (const count of branches) {
            if (count > 0) coveredBranches++
            totalBranches++
          }
        }
      }
    }

    // Functions
    if (isObjectObject(fileData.f)) {
      const functionCounts = Object.values(fileData.f)
      coveredFunctions += countCovered(functionCounts)
      totalFunctions += functionCounts.length
    }

    // Lines
    if (isObjectObject(fileData.l)) {
      const lineCounts = Object.values(fileData.l)
      coveredLines += countCovered(lineCounts)
      totalLines += lineCounts.length
    }
  }

  // Calculate percentages
  const percent = (covered, total) =>
    total > 0 ? Math.floor((covered / total) * 100) : 0

  return {
    statements: {
      covered: coveredStatements,
      total: totalStatements,
      percent: percent(coveredStatements, totalStatements),
    },
    branches: {
      covered: coveredBranches,
      total: totalBranches,
      percent: percent(coveredBranches, totalBranches),
    },
    functions: {
      covered: coveredFunctions,
      total: totalFunctions,
      percent: percent(coveredFunctions, totalFunctions),
    },
    lines: {
      covered: coveredLines,
      total: totalLines,
      percent: percent(coveredLines, totalLines),
    },
  }
}

/**
 * Execute type-coverage command and extract percentage from output.
 * @throws {Error} When type coverage command fails.
 */
export async function getTypeCoverage() {
  const result = await new Promise((resolve) => {
    let stdout = ''
    const child = spawn('pnpm', ['run', 'coverage:type'], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    })

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.on('exit', (code) => {
      resolve({ code: code || 0, stdout })
    })

    child.on('error', () => {
      resolve({ code: 1, stdout: '' })
    })
  })

  if (result.code !== 0) {
    throw new Error(`Failed to get type coverage: exit code ${result.code}`)
  }

  const output = result.stdout || ''
  const lines = output.split('\n')
  const percentageLine = lines.find(line => line.includes('%'))

  if (percentageLine) {
    const match = percentageLine.match(/(\d+(?:\.\d+)?)%/)
    if (match) {
      return Number.parseFloat(match[1])
    }
  }

  return null
}