/**
 * @fileoverview Coverage output formatters.
 */

import { indentString } from '../strings'

import type { FormatCoverageOptions } from './types'

/**
 * Coverage emoji thresholds for visual feedback.
 */
const COVERAGE_EMOJI_THRESHOLDS = [
  { emoji: ' 🚀', threshold: 99 },
  { emoji: ' 🎯', threshold: 95 },
  { emoji: ' ✨', threshold: 90 },
  { emoji: ' 💚', threshold: 85 },
  { emoji: ' ✅', threshold: 80 },
  { emoji: ' 🟢', threshold: 70 },
  { emoji: ' 🟡', threshold: 60 },
  { emoji: ' 🔨', threshold: 50 },
  { emoji: ' ⚠️', threshold: 0 },
]

/**
 * Get emoji for coverage percentage.
 */
export function getCoverageEmoji(percent: number): string {
  const entry = COVERAGE_EMOJI_THRESHOLDS.find(
    ({ threshold }) => percent >= threshold,
  )
  return entry?.emoji || ''
}

/**
 * Format coverage data for console output.
 */
export function formatCoverage(options: FormatCoverageOptions): string {
  const opts = {
    __proto__: null,
    format: 'default' as const,
    ...options,
  } as Required<FormatCoverageOptions>

  const { code, format, type } = opts

  if (format === 'json') {
    return JSON.stringify({ code, type }, null, 2)
  }

  const overall = calculateOverall(code, type)

  if (format === 'simple') {
    return overall
  }

  // Default format with emoji and details.
  let output = ''

  // Code coverage section.
  output += 'Code Coverage:\n'
  output += indentString(`Statements: ${code.statements.percent}%\n`, {
    count: 2,
  })
  output += indentString(`Branches: ${code.branches.percent}%\n`, { count: 2 })
  output += indentString(`Functions: ${code.functions.percent}%\n`, {
    count: 2,
  })
  output += indentString(`Lines: ${code.lines.percent}%\n`, { count: 2 })

  // Type coverage section.
  if (type) {
    output += '\nType Coverage:\n'
    output += indentString(
      `${type.percent}% (${type.covered}/${type.total})\n`,
      { count: 2 },
    )
  }

  // Overall.
  const emoji = getCoverageEmoji(Number.parseFloat(overall))
  output += `\nOverall: ${overall}%${emoji}\n`

  return output
}

/**
 * Calculate overall coverage percentage.
 */
function calculateOverall(
  code: FormatCoverageOptions['code'],
  type: FormatCoverageOptions['type'],
): string {
  const metrics = [
    Number.parseFloat(code.statements.percent),
    Number.parseFloat(code.branches.percent),
    Number.parseFloat(code.functions.percent),
    Number.parseFloat(code.lines.percent),
  ]

  if (type) {
    metrics.push(Number.parseFloat(type.percent))
  }

  const average = metrics.reduce((sum, val) => sum + val, 0) / metrics.length
  return average.toFixed(2)
}
