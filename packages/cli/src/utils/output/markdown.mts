/**
 * Markdown utilities for Socket CLI.
 * Generates formatted markdown output for reports and documentation.
 *
 * Core Functions:
 * - mdHeader: Create markdown headers (# Title, ## Subtitle, etc.)
 * - mdKeyValue: Create bold label with value (** Label**: value)
 * - mdList: Create bullet or numbered lists with optional truncation
 * - mdError: Format error messages with optional cause
 * - mdSection: Create section with header and content
 *
 * Table Functions:
 * - mdTableStringNumber: Create markdown table with string keys and number values
 * - mdTable: Create generic markdown table from array of records
 * - mdTableOfPairs: Create table from array of key-value pairs
 *
 * Table Features:
 * - Auto-sizing columns based on content
 * - Proper alignment for headers and data
 * - Clean markdown-compliant formatting
 *
 * Usage:
 * - Analytics reports
 * - Scan result tables
 * - Statistical summaries
 * - Command output formatting
 */

/**
 * Create a markdown header.
 *
 * @param title - The header text
 * @param level - Header level (1-6), defaults to 1
 * @returns Markdown header string
 *
 * @example
 * mdHeader('Title') // '# Title'
 * mdHeader('Subtitle', 2) // '## Subtitle'
 */
export function mdHeader(title: string, level = 1): string {
  const headerLevel = Math.max(1, Math.min(6, level))
  return `${'#'.repeat(headerLevel)} ${title}`
}

/**
 * Create a markdown key-value pair with bold label.
 *
 * @param label - The label text
 * @param value - The value (string, number, or undefined)
 * @param escaped - Whether to escape markdown in value, defaults to false
 * @returns Markdown formatted key-value string
 *
 * @example
 * mdKeyValue('Status', 'active') // '**Status**: active'
 * mdKeyValue('Count', 42) // '**Count**: 42'
 * mdKeyValue('Missing', undefined) // '**Missing**: N/A'
 */
export function mdKeyValue(
  label: string,
  value: string | number | undefined,
  escaped = false,
): string {
  const displayValue = value === undefined ? 'N/A' : String(value)
  const finalValue = escaped
    ? displayValue.replaceAll('*', '\\*').replaceAll('_', '\\_')
    : displayValue
  return `**${label}**: ${finalValue}`
}

/**
 * Create a markdown list (bullet or numbered).
 *
 * @param items - Array of items to list
 * @param options - Configuration options
 * @param options.ordered - Create numbered list instead of bullets
 * @param options.indent - Indentation level (for nested lists)
 * @param options.truncateAt - Truncate list and show count if exceeds this
 * @returns Markdown formatted list string
 *
 * @example
 * mdList(['item1', 'item2']) // '- item1\n- item2'
 * mdList(['a', 'b'], { ordered: true }) // '1. a\n2. b'
 * mdList([...100items], { truncateAt: 5 }) // First 5 + '...and 95 more'
 */
export function mdList(
  items: string[],
  options?: {
    ordered?: boolean
    indent?: number
    truncateAt?: number
  },
): string {
  const { ordered = false, indent = 0, truncateAt } = { ...options }

  if (!items.length) {
    return ''
  }

  const indentStr = '  '.repeat(indent)
  let displayItems = items
  let suffix = ''

  if (truncateAt && items.length > truncateAt) {
    displayItems = items.slice(0, truncateAt)
    const remaining = items.length - truncateAt
    suffix = `${indentStr}...and ${remaining} more`
  }

  const lines = displayItems.map((item, index) => {
    const prefix = ordered ? `${index + 1}.` : '-'
    return `${indentStr}${prefix} ${item}`
  })

  return suffix ? `${lines.join('\n')}\n${suffix}` : lines.join('\n')
}

/**
 * Format an error message in markdown.
 *
 * @param message - The error message
 * @param cause - Optional error cause/details
 * @returns Markdown formatted error string
 *
 * @example
 * mdError('Failed to connect')
 * // '# Error\n\n**Error**: Failed to connect'
 *
 * mdError('Failed', 'Network timeout')
 * // '# Error\n\n**Error**: Failed\n\n**Cause**: Network timeout'
 */
export function mdError(message: string, cause?: string): string {
  const parts = [mdHeader('Error'), '', mdKeyValue('Error', message)]

  if (cause) {
    parts.push('', mdKeyValue('Cause', cause))
  }

  return parts.join('\n')
}

/**
 * Create a markdown section with optional header.
 *
 * @param title - Section title
 * @param content - Section content (string or array of strings)
 * @param level - Header level (1-6), defaults to 2
 * @returns Markdown formatted section
 *
 * @example
 * mdSection('Details', 'Some content')
 * // '## Details\n\nSome content'
 *
 * mdSection('Info', ['Line 1', 'Line 2'])
 * // '## Info\n\nLine 1\nLine 2'
 */
export function mdSection(
  title: string,
  content: string | string[],
  level = 2,
): string {
  const header = mdHeader(title, level)
  const body = Array.isArray(content) ? content.join('\n') : content
  return `${header}\n\n${body}`
}

export function mdTableStringNumber(
  title1: string,
  title2: string,
  obj: Record<string, number | string>,
): string {
  // | Date        | Counts |
  // | ----------- | ------ |
  // | Header      | 201464 |
  // | Paragraph   |     18 |
  let mw1 = title1.length
  let mw2 = title2.length
  for (const { 0: key, 1: value } of Object.entries(obj)) {
    mw1 = Math.max(mw1, key.length)
    mw2 = Math.max(mw2, String(value ?? '').length)
  }

  const lines = []
  lines.push(`| ${title1.padEnd(mw1, ' ')} | ${title2.padEnd(mw2)} |`)
  lines.push(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} |`)
  for (const { 0: key, 1: value } of Object.entries(obj)) {
    lines.push(
      `| ${key.padEnd(mw1, ' ')} | ${String(value ?? '').padStart(mw2, ' ')} |`,
    )
  }
  lines.push(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} |`)

  return lines.join('\n')
}

export function mdTable<T extends Array<Record<string, string>>>(
  logs: T,
  // This is saying "an array of strings and the strings are a valid key of elements of T"
  // In turn, T is defined above as the audit log event type from our OpenAPI docs.
  cols: Array<string & keyof T[number]>,
  titles: string[] = cols,
): string {
  // Max col width required to fit all data in that column
  const cws = cols.map(col => col.length)

  for (const log of logs) {
    for (let i = 0, { length } = cols; i < length; i += 1) {
      const val: unknown = log[cols[i] ?? ''] ?? ''
      cws[i] = Math.max(
        cws[i] ?? 0,
        String(val).length,
        (titles[i] || '').length,
      )
    }
  }

  let div = '|'
  for (const cw of cws) {
    div += ` ${'-'.repeat(cw)} |`
  }

  let header = '|'
  for (let i = 0, { length } = titles; i < length; i += 1) {
    header += ` ${String(titles[i]).padEnd(cws[i] ?? 0, ' ')} |`
  }

  let body = ''
  for (const log of logs) {
    body += '|'
    for (let i = 0, { length } = cols; i < length; i += 1) {
      const val: unknown = log[cols[i] ?? ''] ?? ''
      body += ` ${String(val).padEnd(cws[i] ?? 0, ' ')} |`
    }
    body += '\n'
  }

  return [div, header, div, body.trim(), div].filter(s => s.trim()).join('\n')
}

export function mdTableOfPairs(
  arr: Array<[string, string]>,
  // This is saying "an array of strings and the strings are a valid key of elements of T"
  // In turn, T is defined above as the audit log event type from our OpenAPI docs.
  cols: string[],
): string {
  // Max col width required to fit all data in that column
  const cws = cols.map(col => col.length)

  for (const [key, val] of arr) {
    cws[0] = Math.max(cws[0] ?? 0, String(key).length)
    cws[1] = Math.max(cws[1] ?? 0, String(val ?? '').length)
  }

  let div = '|'
  for (const cw of cws) {
    div += ` ${'-'.repeat(cw)} |`
  }

  let header = '|'
  for (let i = 0, { length } = cols; i < length; i += 1) {
    header += ` ${String(cols[i]).padEnd(cws[i] ?? 0, ' ')} |`
  }

  let body = ''
  for (const [key, val] of arr) {
    body += '|'
    body += ` ${String(key).padEnd(cws[0] ?? 0, ' ')} |`
    body += ` ${String(val ?? '').padEnd(cws[1] ?? 0, ' ')} |`
    body += '\n'
  }

  return [div, header, div, body.trim(), div].filter(s => s.trim()).join('\n')
}
