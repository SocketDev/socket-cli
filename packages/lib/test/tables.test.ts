/**
 * @fileoverview Unit tests for terminal table formatting utilities.
 *
 * Tests table formatting for CLI output:
 * - formatTable() creates formatted tables with headers and alignment
 * - formatSimpleTable() simpler table format without borders
 * - Column alignment (left, right, center)
 * - Color support via yoctocolors-cjs
 * - Empty data handling, wrapping, truncation
 * Used by Socket CLI for displaying package lists, scan results, and reports.
 */

import colors from 'yoctocolors-cjs'
import { formatSimpleTable, formatTable } from '@socketsecurity/lib/tables'
import { stripAnsi } from '@socketsecurity/lib/strings'
import { describe, expect, it } from 'vitest'

describe('tables', () => {
  describe('formatTable', () => {
    it('should format empty data', () => {
      const result = formatTable([], [])
      expect(result).toBe('(no data)')
    })

    it('should format simple table', () => {
      const data = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '18.2.0' },
      ]
      const columns = [
        { key: 'name', header: 'Package' },
        { key: 'version', header: 'Version' },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('Package')
      expect(result).toContain('Version')
      expect(result).toContain('lodash')
      expect(result).toContain('react')
      expect(result).toContain('4.17.21')
      expect(result).toContain('18.2.0')
    })

    it('should include borders', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const result = formatTable(data, columns)
      const stripped = stripAnsi(result)
      expect(stripped).toContain('┌')
      expect(stripped).toContain('┐')
      expect(stripped).toContain('├')
      expect(stripped).toContain('┤')
      expect(stripped).toContain('└')
      expect(stripped).toContain('┘')
      expect(stripped).toContain('│')
    })

    it('should handle alignment left', () => {
      const data = [{ value: 'test' }]
      const columns = [
        { key: 'value', header: 'Value', align: 'left' as const },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('test')
    })

    it('should handle alignment right', () => {
      const data = [{ value: '42' }]
      const columns = [
        { key: 'value', header: 'Number', align: 'right' as const },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('42')
    })

    it('should handle alignment center', () => {
      const data = [{ value: 'centered' }]
      const columns = [
        { key: 'value', header: 'Value', align: 'center' as const },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('centered')
    })

    it('should handle custom column widths', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name', width: 20 }]

      const result = formatTable(data, columns)
      const lines = stripAnsi(result).split('\n')
      expect(lines.some(line => line.length > 20)).toBe(true)
    })

    it('should apply color functions', () => {
      const data = [{ status: 'ok' }]
      const columns = [
        {
          key: 'status',
          header: 'Status',
          color: (v: string) => colors.green(v),
        },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('ok')
      // Result should have ANSI color codes
      expect(result.length).toBeGreaterThan(stripAnsi(result).length)
    })

    it('should handle missing values', () => {
      const data = [{ name: 'test' }]
      const columns = [
        { key: 'name', header: 'Name' },
        { key: 'missing', header: 'Missing' },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('test')
    })

    it('should handle multiple rows', () => {
      const data = [
        { a: '1', b: '2' },
        { a: '3', b: '4' },
        { a: '5', b: '6' },
      ]
      const columns = [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
      ]

      const result = formatTable(data, columns)
      const lines = result.split('\n')
      expect(lines.length).toBeGreaterThan(5)
    })

    it('should handle wide content', () => {
      const data = [
        { text: 'A very long piece of text that should be handled' },
      ]
      const columns = [{ key: 'text', header: 'Text' }]

      const result = formatTable(data, columns)
      expect(result).toContain('A very long piece of text')
    })

    it('should handle numeric values', () => {
      const data = [{ count: 42, price: 99.99 }]
      const columns = [
        { key: 'count', header: 'Count' },
        { key: 'price', header: 'Price' },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('42')
      expect(result).toContain('99.99')
    })

    it('should handle boolean values', () => {
      const data = [{ enabled: true, disabled: false }]
      const columns = [
        { key: 'enabled', header: 'Enabled' },
        { key: 'disabled', header: 'Disabled' },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('true')
      expect(result).toContain('false')
    })

    it('should handle ANSI colored content', () => {
      const data = [{ name: colors.red('ERROR') }]
      const columns = [{ key: 'name', header: 'Status' }]

      const result = formatTable(data, columns)
      expect(result).toContain('ERROR')
    })

    it('should format headers in bold', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const result = formatTable(data, columns)
      // Bold formatting adds ANSI codes
      expect(result.includes('\x1b[1m')).toBe(true)
    })

    it('should handle empty string values', () => {
      const data = [{ name: '' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const result = formatTable(data, columns)
      expect(stripAnsi(result)).toContain('│')
    })
  })

  describe('formatSimpleTable', () => {
    it('should format empty data', () => {
      const result = formatSimpleTable([], [])
      expect(result).toBe('(no data)')
    })

    it('should format simple table without borders', () => {
      const data = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '18.2.0' },
      ]
      const columns = [
        { key: 'name', header: 'Package' },
        { key: 'version', header: 'Version' },
      ]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('Package')
      expect(result).toContain('Version')
      expect(result).toContain('lodash')
      expect(result).toContain('react')
    })

    it('should not include box borders', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const result = formatSimpleTable(data, columns)
      const stripped = stripAnsi(result)
      expect(stripped).not.toContain('┌')
      expect(stripped).not.toContain('│')
    })

    it('should include separator line', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const result = formatSimpleTable(data, columns)
      expect(stripAnsi(result)).toContain('─')
    })

    it('should handle alignment left', () => {
      const data = [{ value: 'test' }]
      const columns = [
        { key: 'value', header: 'Value', align: 'left' as const },
      ]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('test')
    })

    it('should handle alignment right', () => {
      const data = [{ value: '42' }]
      const columns = [
        { key: 'value', header: 'Number', align: 'right' as const },
      ]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('42')
    })

    it('should handle alignment center', () => {
      const data = [{ value: 'center' }]
      const columns = [
        { key: 'value', header: 'Value', align: 'center' as const },
      ]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('center')
    })

    it('should apply color functions', () => {
      const data = [{ status: 'error' }]
      const columns = [
        {
          key: 'status',
          header: 'Status',
          color: (v: string) => colors.red(v),
        },
      ]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('error')
      // Should have ANSI codes
      expect(result.length).toBeGreaterThan(stripAnsi(result).length)
    })

    it('should handle missing values', () => {
      const data = [{ name: 'test' }]
      const columns = [
        { key: 'name', header: 'Name' },
        { key: 'missing', header: 'Missing' },
      ]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('test')
    })

    it('should handle multiple rows', () => {
      const data = [
        { a: '1', b: '2' },
        { a: '3', b: '4' },
        { a: '5', b: '6' },
      ]
      const columns = [
        { key: 'a', header: 'A' },
        { key: 'b', header: 'B' },
      ]

      const result = formatSimpleTable(data, columns)
      const lines = result.split('\n')
      expect(lines.length).toBeGreaterThan(3)
    })

    it('should handle custom column widths', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name', width: 20 }]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('test')
    })

    it('should handle ANSI colored content', () => {
      const data = [{ status: colors.green('SUCCESS') }]
      const columns = [{ key: 'status', header: 'Status' }]

      const result = formatSimpleTable(data, columns)
      expect(result).toContain('SUCCESS')
    })

    it('should format headers in bold', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const result = formatSimpleTable(data, columns)
      expect(result.includes('\x1b[1m')).toBe(true)
    })

    it('should be more compact than formatTable', () => {
      const data = [{ name: 'test' }]
      const columns = [{ key: 'name', header: 'Name' }]

      const bordered = formatTable(data, columns)
      const simple = formatSimpleTable(data, columns)

      expect(stripAnsi(simple).length).toBeLessThan(stripAnsi(bordered).length)
    })
  })

  describe('edge cases', () => {
    it('should handle special characters', () => {
      const data = [{ text: 'Hello! @#$%^&*()' }]
      const columns = [{ key: 'text', header: 'Text' }]

      const result = formatTable(data, columns)
      expect(result).toContain('Hello!')
    })

    it('should handle unicode characters', () => {
      const data = [{ text: '你好世界' }]
      const columns = [{ key: 'text', header: 'Text' }]

      const result = formatTable(data, columns)
      expect(result).toContain('你好世界')
    })

    it('should handle emoji', () => {
      const data = [{ status: '✓ Done' }]
      const columns = [{ key: 'status', header: 'Status' }]

      const result = formatTable(data, columns)
      expect(result).toContain('✓ Done')
    })

    it('should handle null values', () => {
      const data = [{ value: null }]
      const columns = [{ key: 'value', header: 'Value' }]

      const result = formatTable(data, columns)
      // null is handled by the code - just check it doesn't crash
      expect(stripAnsi(result)).toContain('│')
    })

    it('should handle undefined values', () => {
      const data = [{ value: undefined }]
      const columns = [{ key: 'value', header: 'Value' }]

      const result = formatTable(data, columns)
      // undefined becomes empty string
      expect(stripAnsi(result)).toContain('│')
    })

    it('should handle very long headers', () => {
      const data = [{ x: '1' }]
      const columns = [
        {
          key: 'x',
          header: 'This is a very long header name that extends far',
        },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('This is a very long header')
    })

    it('should handle zero values', () => {
      const data = [{ count: 0 }]
      const columns = [{ key: 'count', header: 'Count' }]

      const result = formatTable(data, columns)
      expect(result).toContain('0')
    })
  })

  describe('integration', () => {
    it('should format complex table with all features', () => {
      const data = [
        { name: 'package1', version: '1.0.0', issues: 0, status: 'ok' },
        { name: 'package2', version: '2.1.3', issues: 3, status: 'warning' },
      ]
      const columns = [
        { key: 'name', header: 'Package', align: 'left' as const },
        { key: 'version', header: 'Version', align: 'center' as const },
        {
          key: 'issues',
          header: 'Issues',
          align: 'right' as const,
          color: (v: string) => (v === '0' ? colors.green(v) : colors.red(v)),
        },
        { key: 'status', header: 'Status', width: 10 },
      ]

      const result = formatTable(data, columns)
      expect(result).toContain('package1')
      expect(result).toContain('package2')
      expect(result).toContain('1.0.0')
      expect(result).toContain('2.1.3')
    })

    it('should produce valid output structure', () => {
      const data = [{ a: '1' }]
      const columns = [{ key: 'a', header: 'A' }]

      const result = formatTable(data, columns)
      const lines = result.split('\n')

      // Should have: top border, header, separator, data row, bottom border
      expect(lines.length).toBe(5)
    })
  })
})
