/**
 * @fileoverview Type definitions for coverage utilities.
 */

/**
 * Code coverage metrics for a single category.
 */
export type CoverageMetric = {
  covered: number
  percent: string
  total: number
}

/**
 * Complete code coverage results from v8.
 */
export type CodeCoverageResult = {
  branches: CoverageMetric
  functions: CoverageMetric
  lines: CoverageMetric
  statements: CoverageMetric
}

/**
 * TypeScript type coverage results.
 */
export type TypeCoverageResult = {
  covered: number
  percent: string
  total: number
}

/**
 * Options for getting code coverage.
 */
export type GetCodeCoverageOptions = {
  coveragePath?: string | undefined
  generateIfMissing?: boolean | undefined
}

/**
 * Options for getting type coverage.
 */
export type GetTypeCoverageOptions = {
  cwd?: string | undefined
  generateIfMissing?: boolean | undefined
}

/**
 * Output format for coverage display.
 */
export type CoverageFormat = 'default' | 'json' | 'simple'

/**
 * Options for formatting coverage output.
 */
export type FormatCoverageOptions = {
  code: CodeCoverageResult
  format?: CoverageFormat | undefined
  type?: TypeCoverageResult | undefined
}

/**
 * V8 coverage data structure for a single file.
 */
export type V8FileCoverage = {
  b?: Record<string, number[]> | undefined
  branchMap?: Record<string, unknown> | undefined
  f?: Record<string, number> | undefined
  fnMap?: Record<string, unknown> | undefined
  path: string
  s?: Record<string, number> | undefined
  statementMap?: Record<string, unknown> | undefined
}

/**
 * V8 coverage-final.json structure.
 */
export type V8CoverageData = Record<string, V8FileCoverage>
