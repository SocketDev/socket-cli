/**
 * @fileoverview Unit tests for regular expression utilities.
 *
 * Tests regex helper functions:
 * - escapeRegExp() escapes special characters for safe regex construction
 * - Handles all regex metacharacters: \, |, {, }, [, ], (, ), *, +, ?, ., ^, $
 * - Prevents regex injection vulnerabilities
 * - Used for dynamic pattern building from user input
 * Used throughout Socket tools for safe regex pattern construction.
 */

import { escapeRegExp } from '@socketsecurity/lib/regexps'
import { describe, expect, it } from 'vitest'

describe('regexps', () => {
  describe('escapeRegExp', () => {
    it('should escape backslash', () => {
      expect(escapeRegExp('\\')).toBe('\\\\')
    })

    it('should escape pipe', () => {
      expect(escapeRegExp('|')).toBe('\\|')
    })

    it('should escape curly braces', () => {
      expect(escapeRegExp('{}')).toBe('\\{\\}')
      expect(escapeRegExp('{')).toBe('\\{')
      expect(escapeRegExp('}')).toBe('\\}')
    })

    it('should escape parentheses', () => {
      expect(escapeRegExp('()')).toBe('\\(\\)')
      expect(escapeRegExp('(')).toBe('\\(')
      expect(escapeRegExp(')')).toBe('\\)')
    })

    it('should escape square brackets', () => {
      expect(escapeRegExp('[]')).toBe('\\[\\]')
      expect(escapeRegExp('[')).toBe('\\[')
      expect(escapeRegExp(']')).toBe('\\]')
    })

    it('should escape caret', () => {
      expect(escapeRegExp('^')).toBe('\\^')
    })

    it('should escape dollar sign', () => {
      expect(escapeRegExp('$')).toBe('\\$')
    })

    it('should escape plus', () => {
      expect(escapeRegExp('+')).toBe('\\+')
    })

    it('should escape asterisk', () => {
      expect(escapeRegExp('*')).toBe('\\*')
    })

    it('should escape question mark', () => {
      expect(escapeRegExp('?')).toBe('\\?')
    })

    it('should escape dot', () => {
      expect(escapeRegExp('.')).toBe('\\.')
    })

    it('should escape multiple special characters', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing regex escape for curly braces
      expect(escapeRegExp('.*+?^${}()|[]')).toBe(
        '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]',
      )
    })

    it('should not escape regular characters', () => {
      expect(escapeRegExp('abc123')).toBe('abc123')
      expect(escapeRegExp('hello world')).toBe('hello world')
    })

    it('should handle mixed strings', () => {
      expect(escapeRegExp('hello.world')).toBe('hello\\.world')
      expect(escapeRegExp('test(123)')).toBe('test\\(123\\)')
      expect(escapeRegExp('price: $50+')).toBe('price: \\$50\\+')
    })

    it('should handle empty string', () => {
      expect(escapeRegExp('')).toBe('')
    })

    it('should work in actual regex', () => {
      const input = 'test.file'
      const escaped = escapeRegExp(input)
      const regex = new RegExp(escaped)

      expect(regex.test('test.file')).toBe(true)
      expect(regex.test('testXfile')).toBe(false)
    })

    it('should escape complex file patterns', () => {
      const pattern = '*.{js,ts}'
      const escaped = escapeRegExp(pattern)
      expect(escaped).toBe('\\*\\.\\{js,ts\\}')
    })

    it('should escape regex quantifiers', () => {
      expect(escapeRegExp('a{1,3}')).toBe('a\\{1,3\\}')
      expect(escapeRegExp('a*')).toBe('a\\*')
      expect(escapeRegExp('a+')).toBe('a\\+')
      expect(escapeRegExp('a?')).toBe('a\\?')
    })

    it('should escape character classes', () => {
      expect(escapeRegExp('[a-z]')).toBe('\\[a-z\\]')
      expect(escapeRegExp('[^0-9]')).toBe('\\[\\^0-9\\]')
    })

    it('should handle unicode characters', () => {
      expect(escapeRegExp('hello世界')).toBe('hello世界')
      expect(escapeRegExp('test.世界')).toBe('test\\.世界')
    })
  })
})
