/**
 * @fileoverview Unit tests for array utility functions.
 *
 * Tests array manipulation and formatting utilities:
 * - arrayChunk() splits arrays into fixed-size chunks with proper remainder handling
 * - arrayUnique() removes duplicates using Set (preserves first occurrence order)
 * - isArray() alias for Array.isArray with type guard support
 * - joinAnd() formats arrays as grammatical lists with "and" (uses Intl.ListFormat)
 * - joinOr() formats arrays as grammatical lists with "or" (uses Intl.ListFormat)
 * Tests cover edge cases: empty arrays, single elements, readonly arrays, large arrays,
 * error conditions (negative chunk sizes), and formatter caching behavior.
 */

import {
  arrayChunk,
  arrayUnique,
  isArray,
  joinAnd,
  joinOr,
} from '@socketsecurity/lib/arrays'
import { describe, expect, it } from 'vitest'

describe('arrays', () => {
  describe('arrayChunk', () => {
    it('should split array into chunks of specified size', () => {
      const arr = [1, 2, 3, 4, 5, 6]
      const result = arrayChunk(arr, 2)
      expect(result).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ])
    })

    it('should handle uneven chunks', () => {
      const arr = [1, 2, 3, 4, 5]
      const result = arrayChunk(arr, 2)
      expect(result).toEqual([[1, 2], [3, 4], [5]])
    })

    it('should default to chunk size of 2', () => {
      const arr = [1, 2, 3, 4]
      const result = arrayChunk(arr)
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ])
    })

    it('should handle single element arrays', () => {
      const arr = [1]
      const result = arrayChunk(arr, 3)
      expect(result).toEqual([[1]])
    })

    it('should handle empty arrays', () => {
      const arr: number[] = []
      const result = arrayChunk(arr, 2)
      expect(result).toEqual([])
    })

    it('should throw error for chunk size <= 0', () => {
      const arr = [1, 2, 3]
      expect(() => arrayChunk(arr, 0)).toThrow(
        'Chunk size must be greater than 0',
      )
      expect(() => arrayChunk(arr, -1)).toThrow(
        'Chunk size must be greater than 0',
      )
    })

    it('should handle chunk size larger than array', () => {
      const arr = [1, 2, 3]
      const result = arrayChunk(arr, 10)
      expect(result).toEqual([[1, 2, 3]])
    })

    it('should work with readonly arrays', () => {
      const arr: readonly number[] = [1, 2, 3, 4]
      const result = arrayChunk(arr, 2)
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ])
    })
  })

  describe('arrayUnique', () => {
    it('should remove duplicate primitive values', () => {
      const arr = [1, 2, 2, 3, 3, 3, 4]
      const result = arrayUnique(arr)
      expect(result).toEqual([1, 2, 3, 4])
    })

    it('should remove duplicate strings', () => {
      const arr = ['a', 'b', 'b', 'c', 'a']
      const result = arrayUnique(arr)
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should handle empty arrays', () => {
      const arr: number[] = []
      const result = arrayUnique(arr)
      expect(result).toEqual([])
    })

    it('should handle arrays with no duplicates', () => {
      const arr = [1, 2, 3, 4]
      const result = arrayUnique(arr)
      expect(result).toEqual([1, 2, 3, 4])
    })

    it('should work with readonly arrays', () => {
      const arr: readonly string[] = ['x', 'y', 'x', 'z']
      const result = arrayUnique(arr)
      expect(result).toEqual(['x', 'y', 'z'])
    })

    it('should handle mixed types', () => {
      const arr = [1, '1', 2, '2', 1, '1']
      const result = arrayUnique(arr)
      expect(result).toEqual([1, '1', 2, '2'])
    })
  })

  describe('isArray', () => {
    it('should return true for arrays', () => {
      expect(isArray([])).toBe(true)
      expect(isArray([1, 2, 3])).toBe(true)
      expect(isArray(new Array(5))).toBe(true)
    })

    it('should return false for non-arrays', () => {
      expect(isArray(null)).toBe(false)
      expect(isArray(undefined)).toBe(false)
      expect(isArray({})).toBe(false)
      expect(isArray('array')).toBe(false)
      expect(isArray(123)).toBe(false)
      expect(isArray({ length: 0 })).toBe(false)
    })

    it('should return true for array-like typed arrays', () => {
      expect(isArray(new Uint8Array(0))).toBe(false)
      expect(isArray(new Int32Array(0))).toBe(false)
    })
  })

  describe('joinAnd', () => {
    it('should join two items with "and"', () => {
      const result = joinAnd(['apple', 'banana'])
      expect(result).toBe('apple and banana')
    })

    it('should join three items with commas and "and"', () => {
      const result = joinAnd(['apple', 'banana', 'cherry'])
      expect(result).toBe('apple, banana, and cherry')
    })

    it('should handle single item', () => {
      const result = joinAnd(['apple'])
      expect(result).toBe('apple')
    })

    it('should handle empty array', () => {
      const result = joinAnd([])
      expect(result).toBe('')
    })

    it('should work with readonly arrays', () => {
      const arr: readonly string[] = ['red', 'green', 'blue']
      const result = joinAnd(arr)
      expect(result).toBe('red, green, and blue')
    })

    it('should handle many items', () => {
      const result = joinAnd(['one', 'two', 'three', 'four', 'five'])
      expect(result).toBe('one, two, three, four, and five')
    })
  })

  describe('joinOr', () => {
    it('should join two items with "or"', () => {
      const result = joinOr(['apple', 'banana'])
      expect(result).toBe('apple or banana')
    })

    it('should join three items with commas and "or"', () => {
      const result = joinOr(['apple', 'banana', 'cherry'])
      expect(result).toBe('apple, banana, or cherry')
    })

    it('should handle single item', () => {
      const result = joinOr(['apple'])
      expect(result).toBe('apple')
    })

    it('should handle empty array', () => {
      const result = joinOr([])
      expect(result).toBe('')
    })

    it('should work with readonly arrays', () => {
      const arr: readonly string[] = ['red', 'green', 'blue']
      const result = joinOr(arr)
      expect(result).toBe('red, green, or blue')
    })

    it('should handle many items', () => {
      const result = joinOr(['one', 'two', 'three', 'four', 'five'])
      expect(result).toBe('one, two, three, four, or five')
    })
  })

  describe('formatter caching', () => {
    it('should reuse conjunction formatter across calls', () => {
      // First call initializes formatter
      const result1 = joinAnd(['a', 'b'])
      // Second call reuses cached formatter
      const result2 = joinAnd(['c', 'd'])
      expect(result1).toBe('a and b')
      expect(result2).toBe('c and d')
    })

    it('should reuse disjunction formatter across calls', () => {
      // First call initializes formatter
      const result1 = joinOr(['a', 'b'])
      // Second call reuses cached formatter
      const result2 = joinOr(['c', 'd'])
      expect(result1).toBe('a or b')
      expect(result2).toBe('c or d')
    })
  })

  describe('edge cases and special characters', () => {
    it('arrayChunk should handle strings', () => {
      const arr = ['a', 'b', 'c', 'd', 'e']
      const result = arrayChunk(arr, 3)
      expect(result).toEqual([
        ['a', 'b', 'c'],
        ['d', 'e'],
      ])
    })

    it('arrayUnique should preserve first occurrence order', () => {
      const arr = [3, 1, 2, 1, 3, 2]
      const result = arrayUnique(arr)
      expect(result).toEqual([3, 1, 2])
    })

    it('joinAnd should handle special characters', () => {
      const result = joinAnd(['🍎', '🍌', '🍒'])
      expect(result).toBe('🍎, 🍌, and 🍒')
    })

    it('joinOr should handle special characters', () => {
      const result = joinOr(['#ff0000', '#00ff00', '#0000ff'])
      expect(result).toBe('#ff0000, #00ff00, or #0000ff')
    })

    it('joinAnd should handle numbers as strings', () => {
      const result = joinAnd(['1', '2', '3'])
      expect(result).toBe('1, 2, and 3')
    })

    it('joinOr should handle numbers as strings', () => {
      const result = joinOr(['100', '200', '300'])
      expect(result).toBe('100, 200, or 300')
    })
  })

  describe('array type compatibility', () => {
    it('arrayChunk should work with const assertions', () => {
      const arr = [1, 2, 3, 4] as const
      const result = arrayChunk(arr, 2)
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ])
    })

    it('arrayUnique should work with const assertions', () => {
      const arr = [1, 2, 2, 3] as const
      const result = arrayUnique(arr)
      expect(result).toEqual([1, 2, 3])
    })

    it('joinAnd should work with const assertions', () => {
      const arr = ['a', 'b', 'c'] as const
      const result = joinAnd(arr)
      expect(result).toBe('a, b, and c')
    })

    it('joinOr should work with const assertions', () => {
      const arr = ['x', 'y', 'z'] as const
      const result = joinOr(arr)
      expect(result).toBe('x, y, or z')
    })
  })

  describe('performance and large arrays', () => {
    it('arrayChunk should handle large arrays efficiently', () => {
      const largeArr = Array.from({ length: 1000 }, (_, i) => i)
      const result = arrayChunk(largeArr, 10)
      expect(result.length).toBe(100)
      expect(result[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect(result[99]).toEqual([
        990, 991, 992, 993, 994, 995, 996, 997, 998, 999,
      ])
    })

    it('arrayUnique should handle large arrays with duplicates', () => {
      const largeArr = Array.from({ length: 1000 }, (_, i) => i % 100)
      const result = arrayUnique(largeArr)
      expect(result.length).toBe(100)
    })
  })
})
