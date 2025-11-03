import { describe, expect, it } from 'vitest'

import { createEnum, pick } from '../../../../src/src/data/objects.mts'

describe('objects utilities', () => {
  describe('createEnum', () => {
    it('creates frozen enum from object', () => {
      const myEnum = createEnum({
        RED: 'red',
        GREEN: 'green',
        BLUE: 'blue',
      })

      expect(myEnum.RED).toBe('red')
      expect(myEnum.GREEN).toBe('green')
      expect(myEnum.BLUE).toBe('blue')
      expect(Object.isFrozen(myEnum)).toBe(true)
    })

    it('prevents modification of enum', () => {
      const myEnum = createEnum({
        VALUE1: 1,
        VALUE2: 2,
      })

      expect(() => {
        ;(myEnum as any).VALUE3 = 3
      }).toThrow()

      expect(() => {
        ;(myEnum as any).VALUE1 = 10
      }).toThrow()
    })

    it('removes prototype chain', () => {
      const myEnum = createEnum({
        KEY: 'value',
      })

      expect(Object.getPrototypeOf(myEnum)).toBe(null)
      expect('toString' in myEnum).toBe(false)
      expect('valueOf' in myEnum).toBe(false)
    })

    it('handles empty object', () => {
      const emptyEnum = createEnum({})
      expect(Object.keys(emptyEnum)).toEqual([])
      expect(Object.isFrozen(emptyEnum)).toBe(true)
    })

    it('handles numeric values', () => {
      const numEnum = createEnum({
        ZERO: 0,
        ONE: 1,
        NEGATIVE: -1,
      })

      expect(numEnum.ZERO).toBe(0)
      expect(numEnum.ONE).toBe(1)
      expect(numEnum.NEGATIVE).toBe(-1)
    })

    it('handles mixed value types', () => {
      const mixedEnum = createEnum({
        STRING: 'text',
        NUMBER: 42,
        BOOLEAN: true,
        NULL: null,
        UNDEFINED: undefined,
      })

      expect(mixedEnum.STRING).toBe('text')
      expect(mixedEnum.NUMBER).toBe(42)
      expect(mixedEnum.BOOLEAN).toBe(true)
      expect(mixedEnum.NULL).toBe(null)
      expect(mixedEnum.UNDEFINED).toBe(undefined)
    })
  })

  describe('pick', () => {
    it('picks specified properties from object', () => {
      const obj = {
        a: 1,
        b: 2,
        c: 3,
        d: 4,
      }

      const result = pick(obj, ['a', 'c'])
      expect(result).toEqual({ a: 1, c: 3 })
    })

    it('handles empty keys array', () => {
      const obj = {
        a: 1,
        b: 2,
      }

      const result = pick(obj, [])
      expect(result).toEqual({})
    })

    it('ignores non-existent keys', () => {
      const obj = {
        a: 1,
        b: 2,
      }

      const result = pick(obj, ['a', 'c' as keyof typeof obj])
      expect(result).toEqual({ a: 1, c: undefined })
    })

    it('works with readonly keys array', () => {
      const obj = {
        x: 'value1',
        y: 'value2',
        z: 'value3',
      }

      const keys = ['x', 'z'] as const
      const result = pick(obj, keys)
      expect(result).toEqual({ x: 'value1', z: 'value3' })
    })

    it('preserves undefined values', () => {
      const obj = {
        a: undefined,
        b: null,
        c: 0,
        d: '',
      }

      const result = pick(obj, ['a', 'b', 'c'])
      expect(result).toEqual({ a: undefined, b: null, c: 0 })
    })

    it('works with complex objects', () => {
      const obj = {
        name: 'test',
        data: { nested: true },
        array: [1, 2, 3],
        func: () => 'result',
      }

      const result = pick(obj, ['name', 'data'])
      expect(result).toEqual({
        name: 'test',
        data: { nested: true },
      })
      expect(result.data).toBe(obj.data) // Same reference.
    })

    it('returns new object', () => {
      const obj = {
        a: 1,
        b: 2,
      }

      const result = pick(obj, ['a', 'b'])
      expect(result).not.toBe(obj)
      expect(result).toEqual({ a: 1, b: 2 })
    })
  })
})
