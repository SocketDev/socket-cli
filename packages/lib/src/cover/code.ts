/**
 * @fileoverview Code coverage utilities for parsing v8 coverage data.
 */

import { promises as fs } from 'fs'

import { readJson } from '../fs'
import { isObjectObject } from '../objects'
import { spawn } from '../spawn'

import type {
  CodeCoverageResult,
  CoverageMetric,
  GetCodeCoverageOptions,
  V8CoverageData,
  V8FileCoverage,
} from './types'

let _path: typeof import('path') | undefined
/**
 * Lazily load the path module to avoid Webpack errors.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _path = /*@__PURE__*/ require('node:path')
  }
  return _path as typeof import('path')
}

/**
 * Get code coverage metrics from v8 coverage-final.json.
 *
 * @throws {Error} When coverage file doesn't exist and generateIfMissing is false.
 * @throws {Error} When coverage data format is invalid.
 */
export async function getCodeCoverage(
  options?: GetCodeCoverageOptions | undefined,
): Promise<CodeCoverageResult> {
  const path = getPath()
  const opts = {
    __proto__: null,
    coveragePath: path.join(process.cwd(), 'coverage/coverage-final.json'),
    generateIfMissing: false,
    ...options,
  } as GetCodeCoverageOptions

  const { coveragePath, generateIfMissing } = opts

  if (!coveragePath) {
    throw new Error('Coverage path is required')
  }

  // Check if coverage file exists.
  const coverageExists = await fs
    .access(coveragePath)
    .then(() => true)
    .catch(() => false)

  if (!coverageExists) {
    if (generateIfMissing) {
      // Run vitest to generate coverage.
      await spawn('vitest', ['run', '--coverage'], {
        cwd: process.cwd(),
        stdio: 'inherit',
      })
    } else {
      throw new Error(
        `Coverage file not found at "${coveragePath}". Run tests with coverage first.`,
      )
    }
  }

  // Read and parse coverage-final.json.
  const coverageData = (await readJson(coveragePath)) as unknown

  if (!isObjectObject(coverageData)) {
    throw new Error(`Invalid coverage data format in "${coveragePath}"`)
  }

  // Aggregate metrics across all files.
  const totals = {
    __proto__: null,
    branches: { __proto__: null, covered: 0, total: 0 },
    functions: { __proto__: null, covered: 0, total: 0 },
    lines: { __proto__: null, covered: 0, total: 0 },
    statements: { __proto__: null, covered: 0, total: 0 },
  }

  const v8Data = coverageData as V8CoverageData

  for (const fileCoverage of Object.values(v8Data)) {
    if (!isObjectObject(fileCoverage)) {
      continue
    }

    const fc = fileCoverage as V8FileCoverage

    // Aggregate statements.
    if (fc.s && isObjectObject(fc.s)) {
      const statementCounts = Object.values(fc.s)
      for (const count of statementCounts) {
        if (typeof count === 'number') {
          totals.statements.total += 1
          if (count > 0) {
            totals.statements.covered += 1
          }
        }
      }
    }

    // Aggregate branches.
    if (fc.b && isObjectObject(fc.b)) {
      const branchCounts = Object.values(fc.b)
      for (const branches of branchCounts) {
        if (Array.isArray(branches)) {
          for (const count of branches) {
            if (typeof count === 'number') {
              totals.branches.total += 1
              if (count > 0) {
                totals.branches.covered += 1
              }
            }
          }
        }
      }
    }

    // Aggregate functions.
    if (fc.f && isObjectObject(fc.f)) {
      const functionCounts = Object.values(fc.f)
      for (const count of functionCounts) {
        if (typeof count === 'number') {
          totals.functions.total += 1
          if (count > 0) {
            totals.functions.covered += 1
          }
        }
      }
    }

    // Note: Lines are typically derived from statement map in v8.
    // For simplicity, we use statements as a proxy for lines.
    // In a production implementation, you'd parse statementMap to get actual line coverage.
    totals.lines.covered = totals.statements.covered
    totals.lines.total = totals.statements.total
  }

  // Calculate percentages.
  return {
    branches: calculateMetric(totals.branches),
    functions: calculateMetric(totals.functions),
    lines: calculateMetric(totals.lines),
    statements: calculateMetric(totals.statements),
  }
}

/**
 * Calculate coverage metric with percentage.
 */
function calculateMetric(data: {
  covered: number
  total: number
}): CoverageMetric {
  const percent =
    data.total === 0 ? '0.00' : ((data.covered / data.total) * 100).toFixed(2)

  return {
    covered: data.covered,
    percent,
    total: data.total,
  }
}
