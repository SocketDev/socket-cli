/**
 * Unit tests for markdown generation.
 *
 * Purpose:
 * Tests markdown generation utilities. Validates markdown table, list, and heading generation.
 *
 * Test Coverage:
 * - Markdown tables
 * - Markdown lists
 * - Heading generation
 * - Code blocks
 * - Link formatting
 * - Escaping
 *
 * Testing Approach:
 * Tests markdown generator used for markdown output mode.
 *
 * Related Files:
 * - utils/output/markdown.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  mdError,
  mdHeader,
  mdKeyValue,
  mdList,
  mdSection,
  mdTable,
  mdTableOfPairs,
  mdTableStringNumber,
} from '../../../../src/utils/output/markdown.mts'

describe('markdown utilities', () => {
  describe('mdHeader', () => {
    it('creates level 1 header by default', () => {
      const result = mdHeader('Title')
      expect(result).toBe('# Title')
    })

    it('creates header at specified level', () => {
      expect(mdHeader('Test', 1)).toBe('# Test')
      expect(mdHeader('Test', 2)).toBe('## Test')
      expect(mdHeader('Test', 3)).toBe('### Test')
      expect(mdHeader('Test', 4)).toBe('#### Test')
      expect(mdHeader('Test', 5)).toBe('##### Test')
      expect(mdHeader('Test', 6)).toBe('###### Test')
    })

    it('clamps level to valid range', () => {
      expect(mdHeader('Test', 0)).toBe('# Test')
      expect(mdHeader('Test', -1)).toBe('# Test')
      expect(mdHeader('Test', 7)).toBe('###### Test')
      expect(mdHeader('Test', 100)).toBe('###### Test')
    })
  })

  describe('mdKeyValue', () => {
    it('formats key-value pair with bold label', () => {
      const result = mdKeyValue('Status', 'active')
      expect(result).toBe('**Status**: active')
    })

    it('handles number values', () => {
      const result = mdKeyValue('Count', 42)
      expect(result).toBe('**Count**: 42')
    })

    it('shows N/A for undefined values', () => {
      const result = mdKeyValue('Missing', undefined)
      expect(result).toBe('**Missing**: N/A')
    })

    it('escapes markdown characters when escaped=true', () => {
      const result = mdKeyValue('Text', 'some *bold* and _italic_', true)
      expect(result).toBe('**Text**: some \\*bold\\* and \\_italic\\_')
    })

    it('does not escape by default', () => {
      const result = mdKeyValue('Text', 'some *bold* text')
      expect(result).toBe('**Text**: some *bold* text')
    })
  })

  describe('mdList', () => {
    it('creates bullet list by default', () => {
      const result = mdList(['item1', 'item2', 'item3'])
      expect(result).toBe('- item1\n- item2\n- item3')
    })

    it('creates ordered list when specified', () => {
      const result = mdList(['first', 'second', 'third'], { ordered: true })
      expect(result).toBe('1. first\n2. second\n3. third')
    })

    it('handles empty array', () => {
      const result = mdList([])
      expect(result).toBe('')
    })

    it('handles single item', () => {
      const result = mdList(['only'])
      expect(result).toBe('- only')
    })

    it('applies indentation', () => {
      const result = mdList(['nested'], { indent: 1 })
      expect(result).toBe('  - nested')
    })

    it('applies multiple indentation levels', () => {
      const result = mdList(['deep'], { indent: 2 })
      expect(result).toBe('    - deep')
    })

    it('truncates list when truncateAt is specified', () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      const result = mdList(items, { truncateAt: 3 })
      expect(result).toContain('- a\n- b\n- c')
      expect(result).toContain('...and 4 more')
    })

    it('does not truncate when list is shorter than truncateAt', () => {
      const items = ['a', 'b']
      const result = mdList(items, { truncateAt: 5 })
      expect(result).toBe('- a\n- b')
      expect(result).not.toContain('more')
    })

    it('combines ordered and indent options', () => {
      const result = mdList(['item'], { ordered: true, indent: 1 })
      expect(result).toBe('  1. item')
    })
  })

  describe('mdError', () => {
    it('formats error message', () => {
      const result = mdError('Failed to connect')
      expect(result).toContain('# Error')
      expect(result).toContain('**Error**: Failed to connect')
    })

    it('includes cause when provided', () => {
      const result = mdError('Failed', 'Network timeout')
      expect(result).toContain('# Error')
      expect(result).toContain('**Error**: Failed')
      expect(result).toContain('**Cause**: Network timeout')
    })

    it('does not include cause section when cause is undefined', () => {
      const result = mdError('Simple error')
      expect(result).not.toContain('Cause')
    })
  })

  describe('mdSection', () => {
    it('creates section with header and content', () => {
      const result = mdSection('Details', 'Some content')
      expect(result).toBe('## Details\n\nSome content')
    })

    it('uses level 2 header by default', () => {
      const result = mdSection('Test', 'Content')
      expect(result).toContain('## Test')
    })

    it('uses specified header level', () => {
      const result = mdSection('Test', 'Content', 3)
      expect(result).toContain('### Test')
    })

    it('handles array content', () => {
      const result = mdSection('Info', ['Line 1', 'Line 2', 'Line 3'])
      expect(result).toBe('## Info\n\nLine 1\nLine 2\nLine 3')
    })

    it('handles empty string content', () => {
      const result = mdSection('Empty', '')
      expect(result).toBe('## Empty\n\n')
    })

    it('handles empty array content', () => {
      const result = mdSection('Empty', [])
      expect(result).toBe('## Empty\n\n')
    })
  })

  describe('mdTableStringNumber', () => {
    it('creates markdown table with string keys and number values', () => {
      const data = {
        First: 100,
        Second: 2500,
        Third: 50,
      }

      const result = mdTableStringNumber('Name', 'Count', data)

      expect(result).toContain('| Name   | Count |')
      expect(result).toContain('| ------ | ----- |')
      expect(result).toContain('| First  |   100 |')
      expect(result).toContain('| Second |  2500 |')
      expect(result).toContain('| Third  |    50 |')
    })

    it('handles string values', () => {
      const data = {
        'Item A': 'Active',
        'Item B': 'Inactive',
      }

      const result = mdTableStringNumber('Item', 'Status', data)

      expect(result).toContain('| Item   | Status   |')
      expect(result).toContain('| Item A |   Active |')
      expect(result).toContain('| Item B | Inactive |')
    })

    it('handles null and undefined values', () => {
      const data = {
        Valid: 123,
        Null: null as any,
        Undefined: undefined as any,
      }

      const result = mdTableStringNumber('Key', 'Value', data)

      expect(result).toContain('| Valid     |   123 |')
      expect(result).toContain('| Null      |       |')
      expect(result).toContain('| Undefined |       |')
    })

    it('adjusts column widths for long values', () => {
      const data = {
        VeryLongKeyName: 1,
        Short: 999999999,
      }

      const result = mdTableStringNumber('K', 'V', data)

      expect(result).toContain('| K               | V         |')
      expect(result).toContain('| VeryLongKeyName |         1 |')
      expect(result).toContain('| Short           | 999999999 |')
    })

    it('handles empty object', () => {
      const data = {}

      const result = mdTableStringNumber('Col1', 'Col2', data)

      expect(result).toContain('| Col1 | Col2 |')
      expect(result).toContain('| ---- | ---- |')
      expect(result.split('\n')).toHaveLength(3)
    })
  })

  describe('mdTable', () => {
    it('creates markdown table from array of objects', () => {
      const logs = [
        { date: '2024-01-01', action: 'create', user: 'alice' },
        { date: '2024-01-02', action: 'update', user: 'bob' },
      ]

      const result = mdTable(logs, ['date', 'action', 'user'])

      expect(result).toContain('| date       | action | user  |')
      expect(result).toContain('| ---------- | ------ | ----- |')
      expect(result).toContain('| 2024-01-01 | create | alice |')
      expect(result).toContain('| 2024-01-02 | update | bob   |')
    })

    it('uses custom titles', () => {
      const logs = [{ id: '1', name: 'Test' }]

      const result = mdTable(logs, ['id', 'name'], ['ID', 'Display Name'])

      expect(result).toContain('| ID | Display Name |')
      expect(result).toContain('| 1  | Test         |')
    })

    it('handles missing properties', () => {
      const logs = [{ a: 'value1' }, { b: 'value2' }] as any[]

      const result = mdTable(logs, ['a', 'b'])

      expect(result).toContain('| a      | b      |')
      expect(result).toContain('| value1 |        |')
      expect(result).toContain('|        | value2 |')
    })

    it('adjusts columns for long values', () => {
      const logs = [
        { short: 'a', long: 'very long value here' },
        { short: 'b', long: 'short' },
      ]

      const result = mdTable(logs, ['short', 'long'])

      expect(result).toContain('| short | long                 |')
      expect(result).toContain('| a     | very long value here |')
      expect(result).toContain('| b     | short                |')
    })

    it('handles empty array', () => {
      const logs: any[] = []

      const result = mdTable(logs, ['col1', 'col2'])

      expect(result).toContain('| col1 | col2 |')
      expect(result).toContain('| ---- | ---- |')
    })

    it('handles non-string values', () => {
      const logs = [{ num: 123, bool: true, obj: { nested: 'value' } }]

      const result = mdTable(logs, ['num', 'bool', 'obj'])

      expect(result).toContain('| 123 | true | [object Object] |')
    })
  })

  describe('mdTableOfPairs', () => {
    it('creates markdown table from array of pairs', () => {
      const pairs: Array<[string, string]> = [
        ['Key1', 'Value1'],
        ['Key2', 'Value2'],
        ['Key3', 'Value3'],
      ]

      const result = mdTableOfPairs(pairs, ['Name', 'Value'])

      expect(result).toContain('| Name | Value  |')
      expect(result).toContain('| ---- | ------ |')
      expect(result).toContain('| Key1 | Value1 |')
      expect(result).toContain('| Key2 | Value2 |')
      expect(result).toContain('| Key3 | Value3 |')
    })

    it('adjusts column widths', () => {
      const pairs: Array<[string, string]> = [
        ['VeryLongKeyName', 'V1'],
        ['K2', 'VeryLongValueHere'],
      ]

      const result = mdTableOfPairs(pairs, ['A', 'B'])

      expect(result).toContain('| A               | B                 |')
      expect(result).toContain('| VeryLongKeyName | V1                |')
      expect(result).toContain('| K2              | VeryLongValueHere |')
    })

    it('handles null and undefined values', () => {
      const pairs: Array<[string, any]> = [
        ['Null', null],
        ['Undefined', undefined],
        ['Empty', ''],
      ]

      const result = mdTableOfPairs(pairs, ['Key', 'Value'])

      expect(result).toContain('| Null      |       |')
      expect(result).toContain('| Undefined |       |')
      expect(result).toContain('| Empty     |       |')
    })

    it('handles empty array', () => {
      const pairs: Array<[string, string]> = []

      const result = mdTableOfPairs(pairs, ['Column1', 'Column2'])

      expect(result).toContain('| Column1 | Column2 |')
      expect(result).toContain('| ------- | ------- |')
      // Empty array produces: div, header, div, div (body.trim() is empty so removed).
      const lines = result.split('\n')
      expect(lines).toHaveLength(4)
      expect(lines[0]).toBe('| ------- | ------- |')
      expect(lines[1]).toBe('| Column1 | Column2 |')
      expect(lines[2]).toBe('| ------- | ------- |')
      expect(lines[3]).toBe('| ------- | ------- |')
    })

    it('handles non-string values', () => {
      const pairs: Array<[any, any]> = [
        [123, true],
        [false, { key: 'value' }],
      ]

      const result = mdTableOfPairs(pairs, ['A', 'B'])

      expect(result).toContain('| 123   | true            |')
      expect(result).toContain('| false | [object Object] |')
    })
  })
})
