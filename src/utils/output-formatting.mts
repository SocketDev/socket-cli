/**
 * Output formatting utilities for Socket CLI.
 * Provides consistent formatting for help text and command output.
 *
 * Key Functions:
 * - getFlagApiRequirementsOutput: Format API requirements for flags
 * - getHelpListOutput: Format help text lists with descriptions
 * - getFlagsHelpOutput: Generate formatted help for command flags
 * - formatTable: Format data as ASCII table with borders
 * - formatSimpleTable: Format data as simple aligned columns
 *
 * Formatting Features:
 * - Automatic indentation and alignment
 * - Flag description formatting
 * - Requirements and permissions display
 * - Hidden flag filtering
 * - Table rendering with borders and alignment
 *
 * Usage:
 * - Used by command help systems
 * - Provides consistent terminal output formatting
 * - Handles kebab-case conversion for flags
 */

import colors from 'yoctocolors-cjs'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { isObject } from '@socketsecurity/registry/lib/objects'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { indentString, stripAnsi } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { getRequirements, getRequirementsKey } from './requirements.mts'
import { camelToKebab } from './strings.mts'

import type { MeowFlags } from '../flags.mts'

type ApiRequirementsOptions = {
  indent?: number | undefined
}

type HelpListOptions = {
  indent?: number | undefined
  keyPrefix?: string | undefined
  padName?: number | undefined
}

type ListDescription =
  | { description: string }
  | { description: string; hidden: boolean }

export function getFlagApiRequirementsOutput(
  cmdPath: string,
  options?: ApiRequirementsOptions | undefined,
): string {
  const { indent = 6 } = {
    __proto__: null,
    ...options,
  } as ApiRequirementsOptions
  const key = getRequirementsKey(cmdPath)
  const requirements = getRequirements()
  const data = (requirements.api as any)[key]
  let result = ''
  if (data) {
    const quota: number = data?.quota
    const rawPerms: string[] = data?.permissions
    const padding = ''.padEnd(indent)
    const lines = []
    if (Number.isFinite(quota) && quota > 0) {
      lines.push(
        `${padding}- Quota: ${quota} ${pluralize('unit', { count: quota })}`,
      )
    }
    if (Array.isArray(rawPerms) && rawPerms.length) {
      const perms = rawPerms.slice().sort(naturalCompare)
      lines.push(`${padding}- Permissions: ${joinAnd(perms)}`)
    }
    result += lines.join('\n')
  }
  return result.trim() || '(none)'
}

export function getFlagListOutput(
  list: MeowFlags,
  options?: HelpListOptions | undefined,
): string {
  const { keyPrefix = '--' } = {
    __proto__: null,
    ...options,
  } as HelpListOptions
  return getHelpListOutput(
    {
      ...list,
    },
    { ...options, keyPrefix },
  )
}

// Alias for testing compatibility.
export const getFlagsHelpOutput = getFlagListOutput

export function getHelpListOutput(
  list: Record<string, ListDescription>,
  options?: HelpListOptions | undefined,
): string {
  const {
    indent = 6,
    keyPrefix = '',
    padName = 20,
  } = {
    __proto__: null,
    ...options,
  } as HelpListOptions
  let result = ''
  const names = Object.keys(list).sort(naturalCompare)
  for (const name of names) {
    const entry = list[name]
    const entryIsObj = isObject(entry)
    if (entryIsObj && 'hidden' in entry && entry?.hidden) {
      continue
    }
    const printedName = `${keyPrefix}${camelToKebab(name)}`
    const preDescription = `${''.padEnd(indent)}${printedName.padEnd(Math.max(printedName.length + 2, padName))}`

    result += preDescription

    const description = entryIsObj ? entry.description : String(entry)
    if (description) {
      result += indentString(description, {
        count: preDescription.length,
      }).trimStart()
    }
    result += '\n'
  }
  return result.trim() || '(none)'
}

/**
 * Table column alignment options.
 */
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
    case 'left':
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
  data: Array<Record<string, any>>,
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
  const topBorder = '┌─' + widths.map(w => '─'.repeat(w)).join('─┬─') + '─┐'
  lines.push(colors.dim(topBorder))

  // Header row
  const headerCells = columns.map((col, i) => {
    const text = colors.bold(col.header)
    return padText(text, widths[i]!, col.align)
  })
  lines.push(
    colors.dim('│ ') + headerCells.join(colors.dim(' │ ')) + colors.dim(' │'),
  )

  // Header separator
  const headerSep = '├─' + widths.map(w => '─'.repeat(w)).join('─┼─') + '─┤'
  lines.push(colors.dim(headerSep))

  // Data rows
  for (const row of data) {
    const cells = columns.map((col, i) => {
      let value = String(row[col.key] ?? '')
      if (col.color) {
        value = col.color(value)
      }
      return padText(value, widths[i]!, col.align)
    })
    lines.push(
      colors.dim('│ ') + cells.join(colors.dim(' │ ')) + colors.dim(' │'),
    )
  }

  // Bottom border
  const bottomBorder = '└─' + widths.map(w => '─'.repeat(w)).join('─┴─') + '─┘'
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
  data: Array<Record<string, any>>,
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
    padText(colors.bold(col.header), widths[i]!, col.align),
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
      return padText(value, widths[i]!, col.align)
    })
    lines.push(cells.join('  '))
  }

  return lines.join('\n')
}
