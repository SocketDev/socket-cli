/**
 * @fileoverview Console footer/summary formatting utilities.
 * Provides consistent footer and summary formatting for CLI applications.
 */

import colors from 'yoctocolors-cjs'
import { repeatString } from '../strings'

export interface FooterOptions {
  /**
   * Width of the footer border in characters.
   * @default 80
   */
  width?: number | undefined
  /**
   * Character to use for the border line.
   * @default '='
   */
  borderChar?: string | undefined
  /**
   * Include ISO timestamp in footer.
   * @default false
   */
  showTimestamp?: boolean | undefined
  /**
   * Show duration since start time.
   * @default false
   */
  showDuration?: boolean | undefined
  /**
   * Start time in milliseconds (from Date.now()).
   * Required when `showDuration` is true.
   */
  startTime?: number | undefined
  /**
   * Color to apply to the footer message.
   * @default 'gray'
   */
  color?:
    | 'cyan'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'red'
    | 'gray'
    | undefined
}

export interface SummaryStats {
  /** Total number of items processed */
  total?: number | undefined
  /** Number of successful items */
  success?: number | undefined
  /** Number of failed items */
  failed?: number | undefined
  /** Number of skipped items */
  skipped?: number | undefined
  /** Number of warnings */
  warnings?: number | undefined
  /** Number of errors */
  errors?: number | undefined
  /** Duration in milliseconds (timestamp value, not elapsed time) */
  duration?: number | undefined
}

/**
 * Create a formatted footer with optional message, timestamp, and duration.
 * Useful for marking the end of CLI output or showing completion status.
 *
 * @param message - Optional message to display in footer
 * @param options - Footer formatting options
 * @returns Formatted footer string with border and optional info
 *
 * @example
 * ```ts
 * const startTime = Date.now()
 * // ... do work
 * console.log(createFooter('Build complete', {
 *   width: 60,
 *   color: 'green',
 *   showDuration: true,
 *   startTime
 * }))
 * ```
 */
export function createFooter(
  message?: string | undefined,
  options?: FooterOptions,
): string {
  const {
    borderChar = '=',
    color = 'gray',
    showDuration = false,
    showTimestamp = false,
    startTime,
    width = 80,
  } = { __proto__: null, ...options } as FooterOptions

  const border = repeatString(borderChar, width)
  const lines: string[] = []

  if (message) {
    const colorFn = color && colors[color] ? colors[color] : (s: string) => s
    lines.push(colorFn(message))
  }

  if (showTimestamp) {
    const timestamp = new Date().toISOString()
    lines.push(colors.gray(`Completed at: ${timestamp}`))
  }

  if (showDuration && startTime) {
    const duration = Date.now() - startTime
    const seconds = (duration / 1000).toFixed(2)
    lines.push(colors.gray(`Duration: ${seconds}s`))
  }

  lines.push(border)
  return lines.join('\n')
}

/**
 * Create a summary footer with statistics and colored status indicators.
 * Automatically formats success/failure/warning counts with appropriate colors.
 * Useful for test results, build summaries, or batch operation reports.
 *
 * @param stats - Statistics to display in the summary
 * @param options - Footer formatting options
 * @returns Formatted summary footer string with colored indicators
 *
 * @example
 * ```ts
 * console.log(createSummaryFooter({
 *   total: 150,
 *   success: 145,
 *   failed: 3,
 *   skipped: 2,
 *   warnings: 5
 * }))
 * // Output: Total: 150 | ✓ 145 passed | ✗ 3 failed | ○ 2 skipped | ⚠ 5 warnings
 * // ========================================
 * ```
 */
export function createSummaryFooter(
  stats: SummaryStats,
  options?: FooterOptions,
): string {
  const parts: string[] = []

  if (stats.total !== undefined) {
    parts.push(`Total: ${stats.total}`)
  }

  if (stats.success !== undefined) {
    parts.push(colors.green(`✓ ${stats.success} passed`))
  }

  if (stats.failed !== undefined && stats.failed > 0) {
    parts.push(colors.red(`✗ ${stats.failed} failed`))
  }

  if (stats.skipped !== undefined && stats.skipped > 0) {
    parts.push(colors.yellow(`○ ${stats.skipped} skipped`))
  }

  if (stats.warnings !== undefined && stats.warnings > 0) {
    parts.push(colors.yellow(`⚠ ${stats.warnings} warnings`))
  }

  if (stats.errors !== undefined && stats.errors > 0) {
    parts.push(colors.red(`✗ ${stats.errors} errors`))
  }

  const message = parts.join(' | ')
  return createFooter(message, {
    ...options,
    showDuration: stats.duration !== undefined,
    ...(stats.duration !== undefined && { startTime: stats.duration }),
  })
}
