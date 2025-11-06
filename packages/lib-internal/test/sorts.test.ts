/**
 * @fileoverview Unit tests for sorting and comparison utilities.
 *
 * Tests comparison functions for array sorting:
 * - localeCompare() locale-aware string comparison
 * - naturalCompare() natural/human-friendly string sorting (handles numbers)
 * - compareStr() basic string comparison
 * - compareSemver() semantic version comparison
 * - naturalSorter() factory for natural sort comparisons
 * Used by Socket tools for sorting package names, versions, and file paths.
 */

import {
  compareSemver,
  compareStr,
  localeCompare,
  naturalCompare,
  naturalSorter,
} from '@socketsecurity/lib/sorts'
import { describe, expect, it } from 'vitest'

describe('sorts', () => {
  describe('localeCompare', () => {
    it('should compare strings in locale-aware manner', () => {
      expect(localeCompare('a', 'b')).toBeLessThan(0)
      expect(localeCompare('b', 'a')).toBeGreaterThan(0)
      expect(localeCompare('a', 'a')).toBe(0)
    })

    it('should handle case sensitivity', () => {
      expect(localeCompare('A', 'a')).not.toBe(0)
    })

    it('should compare empty strings', () => {
      expect(localeCompare('', '')).toBe(0)
      expect(localeCompare('', 'a')).toBeLessThan(0)
      expect(localeCompare('a', '')).toBeGreaterThan(0)
    })

    it('should handle special characters', () => {
      expect(localeCompare('café', 'cafe')).not.toBe(0)
    })

    it('should sort strings correctly', () => {
      const arr = ['zebra', 'apple', 'banana']
      const sorted = arr.slice().sort(localeCompare)
      expect(sorted).toEqual(['apple', 'banana', 'zebra'])
    })

    it('should use cached collator on subsequent calls', () => {
      // First call initializes the collator
      const result1 = localeCompare('test1', 'test2')
      // Second call should use the cached collator
      const result2 = localeCompare('test1', 'test2')
      expect(result1).toBe(result2)
    })
  })

  describe('naturalCompare', () => {
    it('should compare strings naturally', () => {
      expect(naturalCompare('a', 'b')).toBeLessThan(0)
      expect(naturalCompare('b', 'a')).toBeGreaterThan(0)
      expect(naturalCompare('a', 'a')).toBe(0)
    })

    it('should handle numeric sorting correctly', () => {
      expect(naturalCompare('file2', 'file10')).toBeLessThan(0)
      expect(naturalCompare('file10', 'file2')).toBeGreaterThan(0)
      expect(naturalCompare('2', '10')).toBeLessThan(0)
    })

    it('should be case-insensitive', () => {
      expect(naturalCompare('A', 'a')).toBe(0)
      expect(naturalCompare('Apple', 'apple')).toBe(0)
      expect(naturalCompare('ZEBRA', 'zebra')).toBe(0)
    })

    it('should handle diacritics as equivalent', () => {
      expect(naturalCompare('a', 'á')).toBe(0)
      expect(naturalCompare('e', 'é')).toBe(0)
    })

    it('should sort files with numbers naturally', () => {
      const arr = ['file10', 'file2', 'file1', 'file20']
      const sorted = arr.slice().sort(naturalCompare)
      expect(sorted).toEqual(['file1', 'file2', 'file10', 'file20'])
    })

    it('should handle empty strings', () => {
      expect(naturalCompare('', '')).toBe(0)
      expect(naturalCompare('', 'a')).toBeLessThan(0)
      expect(naturalCompare('a', '')).toBeGreaterThan(0)
    })

    it('should handle mixed alphanumeric strings', () => {
      const arr = ['v1.2', 'v1.10', 'v1.3']
      const sorted = arr.slice().sort(naturalCompare)
      expect(sorted).toEqual(['v1.2', 'v1.3', 'v1.10'])
    })

    it('should use cached collator on subsequent calls', () => {
      // First call initializes the collator
      const result1 = naturalCompare('test1', 'test2')
      // Second call should use the cached collator
      const result2 = naturalCompare('test1', 'test2')
      expect(result1).toBe(result2)
    })
  })

  describe('naturalSorter', () => {
    it('should sort array of strings naturally', () => {
      const arr = ['file10', 'file2', 'file1']
      const result = naturalSorter(arr).asc()
      expect(result).toEqual(['file1', 'file2', 'file10'])
    })

    it('should sort in descending order', () => {
      const arr = ['file1', 'file2', 'file10']
      const result = naturalSorter(arr).desc()
      expect(result).toEqual(['file10', 'file2', 'file1'])
    })

    it('should handle empty arrays', () => {
      const arr: string[] = []
      const result = naturalSorter(arr).asc()
      expect(result).toEqual([])
    })

    it('should handle single element arrays', () => {
      const arr = ['file1']
      const result = naturalSorter(arr).asc()
      expect(result).toEqual(['file1'])
    })

    it('should handle objects with selector', () => {
      const arr = [{ name: 'file10' }, { name: 'file2' }, { name: 'file1' }]
      const result = naturalSorter(arr).asc(item => item.name)
      expect(result).toEqual([
        { name: 'file1' },
        { name: 'file2' },
        { name: 'file10' },
      ])
    })

    it('should handle case-insensitive sorting', () => {
      const arr = ['ZEBRA', 'apple', 'Banana']
      const result = naturalSorter(arr).asc()
      expect(result).toEqual(['apple', 'Banana', 'ZEBRA'])
    })

    it('should handle duplicates', () => {
      const arr = ['file2', 'file1', 'file2', 'file3']
      const result = naturalSorter(arr).asc()
      expect(result).toEqual(['file1', 'file2', 'file2', 'file3'])
    })

    it('should use cached sorter on subsequent calls', () => {
      const arr1 = ['file2', 'file1']
      const result1 = naturalSorter(arr1).asc()
      const arr2 = ['file10', 'file5']
      const result2 = naturalSorter(arr2).asc()
      expect(result1).toEqual(['file1', 'file2'])
      expect(result2).toEqual(['file5', 'file10'])
    })

    it('should handle numeric-only strings', () => {
      const arr = ['100', '20', '3', '1']
      const result = naturalSorter(arr).asc()
      expect(result).toEqual(['1', '3', '20', '100'])
    })

    it('should not mutate original array', () => {
      const arr = ['file10', 'file2', 'file1']
      const original = [...arr]
      naturalSorter(arr).asc()
      expect(arr).toEqual(original)
    })
  })

  describe('compareStr', () => {
    it('should compare strings lexicographically', () => {
      expect(compareStr('a', 'b')).toBe(-1)
      expect(compareStr('b', 'a')).toBe(1)
      expect(compareStr('a', 'a')).toBe(0)
    })

    it('should be case-sensitive', () => {
      expect(compareStr('A', 'a')).toBe(-1)
      expect(compareStr('a', 'A')).toBe(1)
    })

    it('should compare empty strings', () => {
      expect(compareStr('', '')).toBe(0)
      expect(compareStr('', 'a')).toBe(-1)
      expect(compareStr('a', '')).toBe(1)
    })

    it('should compare numbers as strings', () => {
      // String comparison, not numeric
      expect(compareStr('10', '2')).toBe(-1) // '1' < '2'
      expect(compareStr('2', '10')).toBe(1)
    })

    it('should sort strings correctly', () => {
      const arr = ['zebra', 'apple', 'banana', 'Apple']
      const sorted = arr.slice().sort(compareStr)
      expect(sorted).toEqual(['Apple', 'apple', 'banana', 'zebra'])
    })

    it('should handle special characters', () => {
      expect(compareStr('!', 'a')).toBe(-1)
      expect(compareStr('a', '!')).toBe(1)
    })

    it('should handle unicode characters', () => {
      expect(compareStr('café', 'cafe')).toBe(1)
    })

    it('should handle multicharacter strings', () => {
      expect(compareStr('abc', 'abd')).toBe(-1)
      expect(compareStr('abd', 'abc')).toBe(1)
      expect(compareStr('abc', 'abc')).toBe(0)
    })
  })

  describe('compareSemver', () => {
    it('should compare valid semantic versions', () => {
      expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0)
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    })

    it('should handle patch version differences', () => {
      expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0)
      expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0)
    })

    it('should handle minor version differences', () => {
      expect(compareSemver('1.0.0', '1.1.0')).toBeLessThan(0)
      expect(compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0)
    })

    it('should handle major version differences', () => {
      expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0)
    })

    it('should handle pre-release versions', () => {
      expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
      expect(compareSemver('1.0.0-beta', '1.0.0')).toBeLessThan(0)
      expect(compareSemver('1.0.0', '1.0.0-beta')).toBeGreaterThan(0)
    })

    it('should handle invalid versions equally', () => {
      expect(compareSemver('invalid', 'also-invalid')).toBe(0)
      expect(compareSemver('not-semver', 'bad-version')).toBe(0)
    })

    it('should handle invalid version less than valid', () => {
      expect(compareSemver('invalid', '1.0.0')).toBe(-1)
    })

    it('should handle valid version greater than invalid', () => {
      expect(compareSemver('1.0.0', 'invalid')).toBe(1)
    })

    it('should sort versions correctly', () => {
      const arr = ['2.0.0', '1.1.0', '1.0.0', '1.0.1']
      const sorted = arr.slice().sort(compareSemver)
      expect(sorted).toEqual(['1.0.0', '1.0.1', '1.1.0', '2.0.0'])
    })

    it('should handle versions with build metadata', () => {
      expect(compareSemver('1.0.0+build1', '1.0.0+build2')).toBe(0)
      expect(compareSemver('1.0.0+build', '1.0.0')).toBe(0)
    })

    it('should handle multi-digit version numbers', () => {
      expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
      expect(compareSemver('10.0.0', '9.0.0')).toBeGreaterThan(0)
    })

    it('should handle mixed valid and invalid versions', () => {
      const arr = ['2.0.0', 'invalid', '1.0.0', '1.5.0']
      const sorted = arr.slice().sort(compareSemver)
      expect(sorted[0]).toBe('invalid') // invalid sorts first
      expect(sorted.slice(1)).toEqual(['1.0.0', '1.5.0', '2.0.0'])
    })

    it('should handle empty strings as invalid', () => {
      expect(compareSemver('', '')).toBe(0)
      expect(compareSemver('', '1.0.0')).toBe(-1)
      expect(compareSemver('1.0.0', '')).toBe(1)
    })
  })
})
