/**
 * @fileoverview Table formatting utilities for CLI applications.
 * Provides ASCII table rendering with borders, alignment, and colors.
 */

import colors from 'yoctocolors-cjs'
import { stripAnsi } from './strings'

export type ColumnAlignment = 'left' | 'right' | 'center'

/**
 * Table column configuration.
 */
export type TableColumn = {
  key: string
  header: string
  align?: ColumnAlignment | undefined
  width?: number | undefined
  color?: ((value: string) => string) | undefined
}

/**
 * Calculate display width accounting for ANSI codes.
 */
function displayWidth(text: string): number {
  return stripAnsi(text).length
}

/**
 * Pad text to specified width with alignment.
 */
function padText(
  text: string,
  width: number,
  align: ColumnAlignment = 'left',
): string {
  const stripped = stripAnsi(text)
  const textWidth = stripped.length
  const padding = Math.max(0, width - textWidth)

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + text
    case 'center': {
      const leftPad = Math.floor(padding / 2)
      const rightPad = padding - leftPad
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad)
    }
    default:
      return text + ' '.repeat(padding)
  }
}

/**
 * Format data as an ASCII table with borders.
 *
 * @param data - Array of data objects
 * @param columns - Column configuration
 * @returns Formatted table string
 *
 * @example
 * import { formatTable } from '@socketsecurity/lib/tables'
 * import colors from 'yoctocolors-cjs'
 *
 * const data = [
 *   { name: 'lodash', version: '4.17.21', issues: 0 },
 *   { name: 'react', version: '18.2.0', issues: 2 },
 * ]
 * const columns = [
 *   { key: 'name', header: 'Package' },
 *   { key: 'version', header: 'Version', align: 'center' },
 *   { key: 'issues', header: 'Issues', align: 'right', color: (v) => v === '0' ? colors.green(v) : colors.red(v) },
 * ]
 * console.log(formatTable(data, columns))
 * // Output:
 * // ┌─────────┬─────────┬────────┐
 * // │ Package │ Version │ Issues │
 * // ├─────────┼─────────┼────────┤
 * // │ lodash  │ 4.17.21 │      0 │
 * // │ react   │ 18.2.0  │      2 │
 * // └─────────┴─────────┴────────┘
 */
export function formatTable(
  data: Array<Record<string, unknown>>,
  columns: TableColumn[],
): string {
  if (data.length === 0) {
    return '(no data)'
  }

  // Calculate column widths
  const widths = columns.map(col => {
    const headerWidth = displayWidth(col.header)
    const maxDataWidth = Math.max(
      ...data.map(row => displayWidth(String(row[col.key] ?? ''))),
    )
    return col.width ?? Math.max(headerWidth, maxDataWidth)
  })

  const lines: string[] = []

  // Top border
  const topBorder = `┌─${widths.map(w => '─'.repeat(w)).join('─┬─')}─┐`
  lines.push(colors.dim(topBorder))

  // Header row
  const headerCells = columns.map((col, i) => {
    const text = colors.bold(col.header)
    return padText(text, widths[i] as number, col.align)
  })
  lines.push(
    colors.dim('│ ') + headerCells.join(colors.dim(' │ ')) + colors.dim(' │'),
  )

  // Header separator
  const headerSep = `├─${widths.map(w => '─'.repeat(w)).join('─┼─')}─┤`
  lines.push(colors.dim(headerSep))

  // Data rows
  for (const row of data) {
    const cells = columns.map((col, i) => {
      let value = String(row[col.key] ?? '')
      if (col.color) {
        value = col.color(value)
      }
      return padText(value, widths[i] as number, col.align)
    })
    lines.push(
      colors.dim('│ ') + cells.join(colors.dim(' │ ')) + colors.dim(' │'),
    )
  }

  // Bottom border
  const bottomBorder = `└─${widths.map(w => '─'.repeat(w)).join('─┴─')}─┘`
  lines.push(colors.dim(bottomBorder))

  return lines.join('\n')
}

/**
 * Format data as a simple table without borders.
 * Lighter weight alternative to formatTable().
 *
 * @param data - Array of data objects
 * @param columns - Column configuration
 * @returns Formatted table string
 *
 * @example
 * import { formatSimpleTable } from '@socketsecurity/lib/tables'
 * import colors from 'yoctocolors-cjs'
 *
 * const data = [
 *   { name: 'lodash', version: '4.17.21' },
 *   { name: 'react', version: '18.2.0' },
 * ]
 * const columns = [
 *   { key: 'name', header: 'Package' },
 *   { key: 'version', header: 'Version' },
 * ]
 * console.log(formatSimpleTable(data, columns))
 * // Output:
 * // Package  Version
 * // ───────  ───────
 * // lodash   4.17.21
 * // react    18.2.0
 */
export function formatSimpleTable(
  data: Array<Record<string, unknown>>,
  columns: TableColumn[],
): string {
  if (data.length === 0) {
    return '(no data)'
  }

  // Calculate column widths
  const widths = columns.map(col => {
    const headerWidth = displayWidth(col.header)
    const maxDataWidth = Math.max(
      ...data.map(row => displayWidth(String(row[col.key] ?? ''))),
    )
    return col.width ?? Math.max(headerWidth, maxDataWidth)
  })

  const lines: string[] = []

  // Header row
  const headerCells = columns.map((col, i) =>
    padText(colors.bold(col.header), widths[i] as number, col.align),
  )
  lines.push(headerCells.join('  '))

  // Header separator
  const separators = widths.map(w => colors.dim('─'.repeat(w)))
  lines.push(separators.join('  '))

  // Data rows
  for (const row of data) {
    const cells = columns.map((col, i) => {
      let value = String(row[col.key] ?? '')
      if (col.color) {
        value = col.color(value)
      }
      return padText(value, widths[i] as number, col.align)
    })
    lines.push(cells.join('  '))
  }

  return lines.join('\n')
}
