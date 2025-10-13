/** @fileoverview Tests for table formatting utilities. */

import colors from 'yoctocolors-cjs'
import { describe, expect, it } from 'vitest'

import {
  formatSimpleTable,
  formatTable,
} from '@socketsecurity/registry/lib/tables'

import type { TableColumn } from '@socketsecurity/registry/lib/tables'

describe('formatTable', () => {
  it('should format empty data', () => {
    const columns: TableColumn[] = [{ key: 'name', header: 'Name' }]
    const result = formatTable([], columns)
    expect(result).toBe('(no data)')
  })

  it('should format simple table with borders', () => {
    const data = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'react', version: '18.2.0' },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      { key: 'version', header: 'Version' },
    ]
    const result = formatTable(data, columns)

    // Should contain box-drawing characters
    expect(result).toContain('┌')
    expect(result).toContain('┐')
    expect(result).toContain('├')
    expect(result).toContain('┤')
    expect(result).toContain('└')
    expect(result).toContain('┘')
    expect(result).toContain('│')
    expect(result).toContain('─')

    // Should contain data
    expect(result).toContain('lodash')
    expect(result).toContain('react')
    expect(result).toContain('4.17.21')
    expect(result).toContain('18.2.0')
  })

  it('should handle right-aligned columns', () => {
    const data = [
      { name: 'lodash', count: 100 },
      { name: 'react', count: 5 },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      { key: 'count', header: 'Count', align: 'right' },
    ]
    const result = formatTable(data, columns)

    // Right-aligned numbers should have leading spaces
    const lines = result.split('\n')
    const dataLines = lines.filter(
      l => l.includes('lodash') || l.includes('react'),
    )
    expect(dataLines.length).toBe(2)

    // Check that numbers appear right-aligned (after package names)
    expect(dataLines[0]).toMatch(/lodash.*100/)
    expect(dataLines[1]).toMatch(/react.*5/)
  })

  it('should handle center-aligned columns', () => {
    const data = [{ status: 'ok' }, { status: 'error' }]
    const columns: TableColumn[] = [
      { key: 'status', header: 'Status', align: 'center' },
    ]
    const result = formatTable(data, columns)

    expect(result).toContain('ok')
    expect(result).toContain('error')
    expect(result).toContain('Status')
  })

  it('should apply color functions', () => {
    const data = [
      { name: 'safe', issues: 0 },
      { name: 'risky', issues: 5 },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      {
        key: 'issues',
        header: 'Issues',
        color: v => (v === '0' ? colors.green(v) : colors.red(v)),
      },
    ]
    const result = formatTable(data, columns)

    // Should contain ANSI color codes
    // eslint-disable-next-line no-control-regex
    expect(result).toMatch(/\u001b\[/)
  })

  it('should handle missing values', () => {
    const data = [
      { name: 'lodash', version: '4.17.21' },
      // Missing version
      { name: 'react' },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      { key: 'version', header: 'Version' },
    ]
    const result = formatTable(data, columns)

    expect(result).toContain('lodash')
    expect(result).toContain('react')
    expect(result).toContain('4.17.21')
  })

  it('should respect fixed column widths', () => {
    const data = [{ name: 'lodash' }]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package', width: 20 },
    ]
    const result = formatTable(data, columns)

    // Top border should reflect fixed width
    // ┌─ + 20 dashes + ─┐
    expect(result).toContain('─'.repeat(20))
  })

  it('should calculate widths based on content', () => {
    const data = [
      { name: 'very-long-package-name', version: '1.0' },
      { name: 'x', version: '2.0' },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Pkg' },
      { key: 'version', header: 'Ver' },
    ]
    const result = formatTable(data, columns)

    // Should accommodate longest value
    expect(result).toContain('very-long-package-name')
  })
})

describe('formatSimpleTable', () => {
  it('should format empty data', () => {
    const columns: TableColumn[] = [{ key: 'name', header: 'Name' }]
    const result = formatSimpleTable([], columns)
    expect(result).toBe('(no data)')
  })

  it('should format simple table without borders', () => {
    const data = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'react', version: '18.2.0' },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      { key: 'version', header: 'Version' },
    ]
    const result = formatSimpleTable(data, columns)

    // Should NOT contain box-drawing borders
    expect(result).not.toContain('┌')
    expect(result).not.toContain('│')

    // Should contain separator line
    expect(result).toContain('─')

    // Should contain data
    expect(result).toContain('lodash')
    expect(result).toContain('react')
    expect(result).toContain('4.17.21')
    expect(result).toContain('18.2.0')
  })

  it('should handle alignment in simple tables', () => {
    const data = [
      { name: 'lodash', count: 100 },
      { name: 'react', count: 5 },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      { key: 'count', header: 'Count', align: 'right' },
    ]
    const result = formatSimpleTable(data, columns)

    expect(result).toContain('lodash')
    expect(result).toContain('react')
    expect(result).toContain('100')
    expect(result).toContain('5')
  })

  it('should apply color functions in simple tables', () => {
    const data = [{ status: 'ok' }]
    const columns: TableColumn[] = [
      {
        key: 'status',
        header: 'Status',
        color: v => colors.green(v),
      },
    ]
    const result = formatSimpleTable(data, columns)

    // Should contain ANSI color codes
    // eslint-disable-next-line no-control-regex
    expect(result).toMatch(/\u001b\[/)
  })

  it('should handle missing values in simple tables', () => {
    const data = [
      { name: 'lodash', version: '4.17.21' },
      // Missing version
      { name: 'react' },
    ]
    const columns: TableColumn[] = [
      { key: 'name', header: 'Package' },
      { key: 'version', header: 'Version' },
    ]
    const result = formatSimpleTable(data, columns)

    expect(result).toContain('lodash')
    expect(result).toContain('react')
    expect(result).toContain('4.17.21')
  })

  it('should have lighter weight output than bordered table', () => {
    const data = [{ name: 'lodash' }]
    const columns: TableColumn[] = [{ key: 'name', header: 'Package' }]

    const bordered = formatTable(data, columns)
    const simple = formatSimpleTable(data, columns)

    // Simple should be shorter (fewer characters)
    expect(simple.length).toBeLessThan(bordered.length)
  })
})
