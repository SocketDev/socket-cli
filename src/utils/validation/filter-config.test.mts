import { describe, expect, it, vi } from 'vitest'

import { toFilterConfig } from './filter-config.mts'

// Mock @socketsecurity/registry/lib/objects.
vi.mock('@socketsecurity/registry/lib/objects', () => ({
  isObject: vi.fn(val => {
    return val !== null && typeof val === 'object' && !Array.isArray(val)
  }),
}))

describe('filter-config utilities', () => {
  describe('toFilterConfig', () => {
    it('normalizes object with boolean values', () => {
      const input = {
        enabled: true,
        disabled: false,
        someFeature: true,
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        enabled: true,
        disabled: false,
        someFeature: true,
      })
      expect(Object.getPrototypeOf(result)).toBe(null)
    })

    it('normalizes object with array values', () => {
      const input = {
        allowedTypes: ['type1', 'type2'],
        blockedTypes: [],
        mixedArray: [1, 'two', true],
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        allowedTypes: ['type1', 'type2'],
        blockedTypes: [],
        mixedArray: [1, 'two', true],
      })
    })

    it('filters out non-boolean and non-array values', () => {
      const input = {
        boolValue: true,
        arrayValue: ['test'],
        stringValue: 'should be filtered',
        numberValue: 42,
        nullValue: null,
        undefinedValue: undefined,
        objectValue: { nested: true },
        functionValue: () => {},
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        boolValue: true,
        arrayValue: ['test'],
      })
    })

    it('handles mixed valid and invalid values', () => {
      const input = {
        feature1: true,
        feature2: 'invalid',
        feature3: ['valid', 'array'],
        feature4: 123,
        feature5: false,
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        feature1: true,
        feature3: ['valid', 'array'],
        feature5: false,
      })
    })

    it('returns empty object for non-object input', async () => {
      const { isObject } = vi.mocked(
        await import('@socketsecurity/registry/lib/objects'),
      )

      isObject.mockReturnValue(false)

      expect(toFilterConfig(null)).toEqual({})
      expect(toFilterConfig(undefined)).toEqual({})
      expect(toFilterConfig('string')).toEqual({})
      expect(toFilterConfig(123)).toEqual({})
      expect(toFilterConfig(true)).toEqual({})
      expect(toFilterConfig([])).toEqual({})
    })

    it('returns empty object for empty input object', async () => {
      const { isObject } = vi.mocked(
        await import('@socketsecurity/registry/lib/objects'),
      )
      isObject.mockReturnValue(true)

      const result = toFilterConfig({})

      expect(result).toEqual({})
      expect(Object.getPrototypeOf(result)).toBe(null)
    })

    it('preserves nested arrays', () => {
      const input = {
        nestedArrays: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        deepNested: [
          [
            [1, 2],
            [3, 4],
          ],
          [[5, 6]],
        ],
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        nestedArrays: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        deepNested: [
          [
            [1, 2],
            [3, 4],
          ],
          [[5, 6]],
        ],
      })
    })

    it('handles objects with prototype chain', () => {
      class CustomClass {
        inherited = true
      }
      const obj = new CustomClass()
      obj.direct = false
      obj.array = ['test']

      const result = toFilterConfig(obj)

      // Should include both inherited and direct properties if they're valid.
      expect(result).toEqual({
        inherited: true,
        direct: false,
        array: ['test'],
      })
    })

    it('handles objects with symbol keys', () => {
      const sym = Symbol('test')
      const input = {
        normal: true,
        [sym]: false,
      }

      const result = toFilterConfig(input)

      // Symbol keys are ignored by Object.keys.
      expect(result).toEqual({
        normal: true,
      })
    })

    it('handles objects with numeric keys', () => {
      const input = {
        0: true,
        1: false,
        100: ['array'],
        stringKey: true,
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        0: true,
        1: false,
        100: ['array'],
        stringKey: true,
      })
    })

    it('creates object with null prototype', () => {
      const result = toFilterConfig({ test: true })

      expect(Object.getPrototypeOf(result)).toBe(null)
      expect(result.constructor).toBeUndefined()
      expect(result.toString).toBeUndefined()
      expect(result.valueOf).toBeUndefined()
    })

    it('handles edge case with __proto__ key', () => {
      const input = {
        __proto__: true,
        normal: false,
      }

      const result = toFilterConfig(input)

      expect(result).toEqual({
        __proto__: true,
        normal: false,
      })
      expect(Object.getPrototypeOf(result)).toBe(null)
    })
  })
})
