/**
 * @fileoverview Unit tests for environment variable type conversion helpers.
 *
 * Tests type coercion utilities for environment variables:
 * - envAsBoolean() converts strings to boolean ("true", "1", "yes" → true)
 * - envAsNumber() parses strings to numbers with fallback
 * - envAsString() ensures string type
 * Used for consistent environment variable type handling across Socket tools.
 * No rewire needed - these are pure functions without env access.
 */

import {
  envAsBoolean,
  envAsNumber,
  envAsString,
} from '@socketsecurity/lib/env/helpers'
import { describe, expect, it } from 'vitest'

describe('env/helpers', () => {
  describe('envAsBoolean', () => {
    it('should return true for "true"', () => {
      expect(envAsBoolean('true')).toBe(true)
    })

    it('should return true for "TRUE"', () => {
      expect(envAsBoolean('TRUE')).toBe(true)
    })

    it('should return true for "True"', () => {
      expect(envAsBoolean('True')).toBe(true)
    })

    it('should return true for "1"', () => {
      expect(envAsBoolean('1')).toBe(true)
    })

    it('should return true for "yes"', () => {
      expect(envAsBoolean('yes')).toBe(true)
    })

    it('should return true for "YES"', () => {
      expect(envAsBoolean('YES')).toBe(true)
    })

    it('should return true for "Yes"', () => {
      expect(envAsBoolean('Yes')).toBe(true)
    })

    it('should return false for "false"', () => {
      expect(envAsBoolean('false')).toBe(false)
    })

    it('should return false for "0"', () => {
      expect(envAsBoolean('0')).toBe(false)
    })

    it('should return false for "no"', () => {
      expect(envAsBoolean('no')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(envAsBoolean('')).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(envAsBoolean(undefined)).toBe(false)
    })

    it('should return false for arbitrary strings', () => {
      expect(envAsBoolean('maybe')).toBe(false)
      expect(envAsBoolean('hello')).toBe(false)
      expect(envAsBoolean('world')).toBe(false)
    })

    it('should return false for whitespace', () => {
      expect(envAsBoolean(' ')).toBe(false)
      expect(envAsBoolean('  ')).toBe(false)
    })

    it('should return false for strings with whitespace around true', () => {
      expect(envAsBoolean(' true ')).toBe(false)
    })

    it('should return false for numeric strings other than 1', () => {
      expect(envAsBoolean('2')).toBe(false)
      expect(envAsBoolean('100')).toBe(false)
      expect(envAsBoolean('-1')).toBe(false)
    })

    it('should return false for special characters', () => {
      expect(envAsBoolean('!')).toBe(false)
      expect(envAsBoolean('@')).toBe(false)
    })

    it('should be case-insensitive for true', () => {
      expect(envAsBoolean('tRuE')).toBe(true)
      expect(envAsBoolean('TrUe')).toBe(true)
    })

    it('should be case-insensitive for yes', () => {
      expect(envAsBoolean('yEs')).toBe(true)
      expect(envAsBoolean('YeS')).toBe(true)
    })

    it('should handle null coerced to string', () => {
      expect(envAsBoolean('null')).toBe(false)
    })
  })

  describe('envAsNumber', () => {
    it('should return number for valid numeric string', () => {
      expect(envAsNumber('42')).toBe(42)
    })

    it('should return 0 for undefined', () => {
      expect(envAsNumber(undefined)).toBe(0)
    })

    it('should return 0 for empty string', () => {
      expect(envAsNumber('')).toBe(0)
    })

    it('should handle negative numbers', () => {
      expect(envAsNumber('-42')).toBe(-42)
    })

    it('should handle decimal numbers', () => {
      expect(envAsNumber('3.14')).toBe(3.14)
    })

    it('should handle zero', () => {
      expect(envAsNumber('0')).toBe(0)
    })

    it('should handle large numbers', () => {
      expect(envAsNumber('1000000')).toBe(1_000_000)
    })

    it('should handle scientific notation', () => {
      expect(envAsNumber('1e6')).toBe(1_000_000)
    })

    it('should return 0 for non-numeric strings', () => {
      expect(envAsNumber('abc')).toBe(0)
      expect(envAsNumber('hello')).toBe(0)
    })

    it('should return 0 for NaN strings', () => {
      expect(envAsNumber('NaN')).toBe(0)
    })

    it('should handle Infinity as special case', () => {
      expect(envAsNumber('Infinity')).toBe(Number.POSITIVE_INFINITY)
    })

    it('should handle -Infinity as special case', () => {
      expect(envAsNumber('-Infinity')).toBe(Number.NEGATIVE_INFINITY)
    })

    it('should handle whitespace around numbers', () => {
      expect(envAsNumber(' 42 ')).toBe(42)
    })

    it('should handle hexadecimal numbers', () => {
      expect(envAsNumber('0x10')).toBe(16)
    })

    it('should handle octal numbers', () => {
      expect(envAsNumber('0o10')).toBe(8)
    })

    it('should handle binary numbers', () => {
      expect(envAsNumber('0b10')).toBe(2)
    })

    it('should return 0 for strings with non-numeric characters', () => {
      expect(envAsNumber('42abc')).toBe(0)
      expect(envAsNumber('abc42')).toBe(0)
    })

    it('should handle very small numbers', () => {
      expect(envAsNumber('0.0001')).toBe(0.0001)
    })

    it('should handle negative decimals', () => {
      expect(envAsNumber('-3.14')).toBe(-3.14)
    })

    it('should return 0 for special characters', () => {
      expect(envAsNumber('!')).toBe(0)
      expect(envAsNumber('@')).toBe(0)
    })

    it('should handle numeric strings with leading zeros', () => {
      expect(envAsNumber('007')).toBe(7)
    })
  })

  describe('envAsString', () => {
    it('should return string value when defined', () => {
      expect(envAsString('hello')).toBe('hello')
    })

    it('should return empty string for undefined', () => {
      expect(envAsString(undefined)).toBe('')
    })

    it('should return empty string for empty string', () => {
      expect(envAsString('')).toBe('')
    })

    it('should preserve whitespace', () => {
      expect(envAsString(' hello ')).toBe(' hello ')
    })

    it('should handle numeric strings', () => {
      expect(envAsString('123')).toBe('123')
    })

    it('should handle special characters', () => {
      expect(envAsString('hello@world!')).toBe('hello@world!')
    })

    it('should handle newlines', () => {
      expect(envAsString('hello\nworld')).toBe('hello\nworld')
    })

    it('should handle tabs', () => {
      expect(envAsString('hello\tworld')).toBe('hello\tworld')
    })

    it('should handle unicode', () => {
      expect(envAsString('hello 世界')).toBe('hello 世界')
    })

    it('should handle emojis', () => {
      expect(envAsString('hello 👋')).toBe('hello 👋')
    })

    it('should handle long strings', () => {
      const longString = 'a'.repeat(1000)
      expect(envAsString(longString)).toBe(longString)
    })

    it('should handle JSON strings', () => {
      expect(envAsString('{"key":"value"}')).toBe('{"key":"value"}')
    })

    it('should handle URLs', () => {
      expect(envAsString('https://example.com')).toBe('https://example.com')
    })

    it('should handle paths', () => {
      expect(envAsString('/usr/bin:/bin')).toBe('/usr/bin:/bin')
    })

    it('should handle single character', () => {
      expect(envAsString('a')).toBe('a')
    })

    it('should handle only whitespace', () => {
      expect(envAsString('   ')).toBe('   ')
    })

    it('should handle mixed content', () => {
      expect(envAsString('abc123!@#')).toBe('abc123!@#')
    })

    it('should handle quotes', () => {
      expect(envAsString('"quoted"')).toBe('"quoted"')
      expect(envAsString("'quoted'")).toBe("'quoted'")
    })

    it('should handle backslashes', () => {
      expect(envAsString('C:\\Windows\\System32')).toBe('C:\\Windows\\System32')
    })

    it('should handle forward slashes', () => {
      expect(envAsString('/usr/local/bin')).toBe('/usr/local/bin')
    })
  })
})
