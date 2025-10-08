/** @fileoverview Standardized logging utilities to DRY up common patterns */

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

/**
 * Severity levels for consistent formatting
 */
export const Severity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
} as const

export type SeverityLevel = typeof Severity[keyof typeof Severity]

/**
 * Get color for severity level
 */
export function getSeverityColor(severity: SeverityLevel): (text: string) => string {
  switch (severity) {
    case Severity.CRITICAL: return colors.red
    case Severity.HIGH: return colors.magenta
    case Severity.MEDIUM: return colors.yellow
    case Severity.LOW: return colors.blue
    default: return colors.gray
  }
}

/**
 * Log a section header
 */
export function logSection(title: string, icon?: string): void {
  logger.log('')
  if (icon) {
    logger.log(`${icon} ${colors.cyan(title)}`)
  } else {
    logger.log(colors.cyan(title))
  }
  logger.log(colors.dim('─'.repeat(40)))
}

/**
 * Log a list with consistent formatting
 */
export function logList(items: string[], indent: number = 2): void {
  const indentStr = ' '.repeat(indent)
  for (const item of items) {
    logger.log(`${indentStr}• ${item}`)
  }
}

/**
 * Log a key-value pair
 */
export function logKeyValue(key: string, value: string | number, indent: number = 0): void {
  const indentStr = ' '.repeat(indent)
  logger.log(`${indentStr}${key}: ${value}`)
}

/**
 * Log a result summary
 */
export function logResult(
  success: boolean,
  message: string,
  details?: string[]
): void {
  logger.log('')

  if (success) {
    logger.success(message)
  } else {
    logger.error(message)
  }

  if (details && details.length > 0) {
    logList(details)
  }
}

/**
 * Log a warning with consistent formatting
 */
export function logWarning(message: string, details?: string[]): void {
  logger.log('')
  logger.warn(message)

  if (details && details.length > 0) {
    logList(details)
  }
}

/**
 * Log an error with consistent formatting
 */
export function logError(message: string, details?: string[]): void {
  logger.log('')
  logger.error(message)

  if (details && details.length > 0) {
    logList(details)
  }
}

/**
 * Log progress step
 */
export function logStep(step: number, total: number, message: string): void {
  const progress = `[${step}/${total}]`
  logger.log(`${colors.dim(progress)} ${message}`)
}

/**
 * Log a table header
 */
export function logTableHeader(columns: string[]): void {
  const header = columns.map(col => colors.magenta(col)).join(' | ')
  logger.log(header)
  logger.log(colors.dim('─'.repeat(header.length)))
}

/**
 * Log a table row
 */
export function logTableRow(values: Array<string | number>): void {
  logger.log(values.join(' | '))
}

/**
 * Format file path for logging
 */
export function formatPath(path: string): string {
  return colors.blue(path)
}

/**
 * Format command for logging
 */
export function formatCommand(command: string): string {
  return colors.cyan(command)
}

/**
 * Format count with proper pluralization
 */
export function formatCount(count: number, singular: string, plural?: string): string {
  const label = count === 1 ? singular : (plural || `${singular}s`)
  return `${count} ${label}`
}

/**
 * Log vulnerability summary with consistent formatting
 */
export function logVulnerabilitySummary(counts: {
  critical?: number
  high?: number
  medium?: number
  low?: number
}): void {
  const items = []

  if (counts.critical && counts.critical > 0) {
    items.push(`Critical: ${colors.red(String(counts.critical))}`)
  }
  if (counts.high && counts.high > 0) {
    items.push(`High: ${colors.magenta(String(counts.high))}`)
  }
  if (counts.medium && counts.medium > 0) {
    items.push(`Medium: ${colors.yellow(String(counts.medium))}`)
  }
  if (counts.low && counts.low > 0) {
    items.push(`Low: ${colors.blue(String(counts.low))}`)
  }

  if (items.length > 0) {
    logger.log('')
    logger.log('Vulnerabilities found:')
    logList(items)
  } else {
    logResult(true, 'No vulnerabilities found')
  }
}

/**
 * Create a formatted badge
 */
export function formatBadge(text: string, color: (text: string) => string): string {
  return color(`[${text}]`)
}

/**
 * Log with consistent spacing
 */
export function logSpaced(message: string): void {
  logger.log('')
  logger.log(message)
  logger.log('')
}

/**
 * Format time duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Log timing information
 */
export function logTiming(_operation: string, startTime: number): void {
  const duration = formatDuration(Date.now() - startTime)
  logger.log(colors.dim(`Completed in ${duration}`))
}