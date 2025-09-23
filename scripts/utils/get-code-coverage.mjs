import { existsSync } from 'node:fs'
import path from 'node:path'

import constants from '@socketsecurity/registry/lib/constants'
import { readJson } from '@socketsecurity/registry/lib/fs'
import { isObjectObject } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

function countCovered(counts) {
  return counts.filter(count => count > 0).length
}

export async function getCodeCoverage(options = {}) {
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

    const result = await spawn('pnpm', ['run', 'test:unit:coverage'], {
      stdio: 'ignore',
      shell: constants.WIN32,
    })

    if (result.code !== 0) {
      throw new Error(
        `Failed to generate coverage data: exit code ${result.code}`,
      )
    }
  }

  const coverageData = await readJson(coverageJsonPath, { throws: false })
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
