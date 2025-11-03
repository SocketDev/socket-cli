import { describe, expect, it } from 'vitest'

import {
  mdTable,
  mdTableOfPairs,
  mdTableStringNumber,
} from '../../../../../src/utils/output/markdown.mts'

describe('markdown utilities', () => {
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
