/**
 * @fileoverview Unit tests for string manipulation utilities.
 *
 * Tests comprehensive string processing functions:
 * - ANSI handling: ansiRegex(), stripAnsi() for terminal color code processing
 * - Line manipulation: applyLinePrefix(), indentString(), trimNewlines()
 * - Case conversion: camelToKebab(), toKebabCase() with snake_case support
 * - Text formatting: centerText(), repeatString()
 * - Width calculation: stringWidth() accounts for CJK characters, emoji, combining marks
 * - Type guards: isBlankString(), isNonEmptyString()
 * - Utilities: stripBom(), search() with fromIndex support
 * Tests include extensive edge cases for Unicode (emoji, CJK, zero-width chars),
 * ANSI escape codes, platform line endings, and terminal column width calculations.
 * stringWidth() based on string-width by Sindre Sorhus (MIT).
 */

import {
  ansiRegex,
  applyLinePrefix,
  camelToKebab,
  centerText,
  indentString,
  isBlankString,
  isNonEmptyString,
  repeatString,
  search,
  stringWidth,
  stripAnsi,
  stripBom,
  toKebabCase,
  trimNewlines,
} from '@socketsecurity/lib/strings'
import { describe, expect, it } from 'vitest'

describe('strings', () => {
  describe('ansiRegex', () => {
    it('should match ANSI escape codes', () => {
      expect('\x1b[31mred\x1b[0m'.match(ansiRegex())).toBeTruthy()
      expect('\x1b[1mbold\x1b[0m'.match(ansiRegex())).toBeTruthy()
    })

    it('should not match plain text', () => {
      expect('plain text'.match(ansiRegex())).toBeNull()
    })
  })

  describe('stripAnsi', () => {
    it('should remove ANSI escape codes', () => {
      expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
      expect(stripAnsi('\x1b[1mbold\x1b[22m text')).toBe('bold text')
    })

    it('should return plain text unchanged', () => {
      expect(stripAnsi('plain text')).toBe('plain text')
    })

    it('should handle empty strings', () => {
      expect(stripAnsi('')).toBe('')
    })
  })

  describe('applyLinePrefix', () => {
    it('should apply prefix to single line', () => {
      const result = applyLinePrefix('hello', { prefix: '> ' })
      expect(result).toBe('> hello')
    })

    it('should apply prefix to multiple lines', () => {
      const result = applyLinePrefix('line1\nline2\nline3', { prefix: '> ' })
      expect(result).toBe('> line1\n> line2\n> line3')
    })

    it('should handle empty prefix', () => {
      const result = applyLinePrefix('hello', { prefix: '' })
      expect(result).toBe('hello')
    })

    it('should handle no options', () => {
      const result = applyLinePrefix('hello')
      expect(result).toBe('hello')
    })

    it('should apply prefix even to empty string', () => {
      const result = applyLinePrefix('', { prefix: '> ' })
      expect(result).toBe('> ')
    })
  })

  describe('camelToKebab', () => {
    it('should convert simple camelCase', () => {
      expect(camelToKebab('camelCase')).toBe('camel-case')
      expect(camelToKebab('myVariableName')).toBe('my-variable-name')
    })

    it('should handle consecutive uppercase letters', () => {
      expect(camelToKebab('HTTPServer')).toBe('httpserver')
      expect(camelToKebab('XMLParser')).toBe('xmlparser')
    })

    it('should handle already lowercase', () => {
      expect(camelToKebab('lowercase')).toBe('lowercase')
    })

    it('should handle empty string', () => {
      expect(camelToKebab('')).toBe('')
    })

    it('should handle single letter', () => {
      expect(camelToKebab('A')).toBe('a')
      expect(camelToKebab('a')).toBe('a')
    })

    it('should handle numbers', () => {
      expect(camelToKebab('version2')).toBe('version2')
      expect(camelToKebab('http2Server')).toBe('http2-server')
    })
  })

  describe('indentString', () => {
    it('should indent single line with default count', () => {
      expect(indentString('hello')).toBe(' hello')
    })

    it('should indent with custom count', () => {
      expect(indentString('hello', { count: 4 })).toBe('    hello')
    })

    it('should indent multiple lines', () => {
      const result = indentString('line1\nline2\nline3', { count: 2 })
      expect(result).toBe('  line1\n  line2\n  line3')
    })

    it('should not indent empty lines', () => {
      const result = indentString('line1\n\nline3', { count: 2 })
      expect(result).toBe('  line1\n\n  line3')
    })

    it('should handle empty string', () => {
      expect(indentString('')).toBe('')
    })
  })

  describe('isBlankString', () => {
    it('should return true for empty string', () => {
      expect(isBlankString('')).toBe(true)
    })

    it('should return true for whitespace-only strings', () => {
      expect(isBlankString(' ')).toBe(true)
      expect(isBlankString('  ')).toBe(true)
      expect(isBlankString('\t')).toBe(true)
      expect(isBlankString('\n')).toBe(true)
      expect(isBlankString(' \t\n ')).toBe(true)
    })

    it('should return false for non-empty strings', () => {
      expect(isBlankString('hello')).toBe(false)
      expect(isBlankString(' hello ')).toBe(false)
    })

    it('should return false for non-strings', () => {
      expect(isBlankString(null)).toBe(false)
      expect(isBlankString(undefined)).toBe(false)
      expect(isBlankString(123)).toBe(false)
      expect(isBlankString({})).toBe(false)
    })
  })

  describe('isNonEmptyString', () => {
    it('should return true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true)
      expect(isNonEmptyString(' ')).toBe(true)
      expect(isNonEmptyString('a')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false)
    })

    it('should return false for non-strings', () => {
      expect(isNonEmptyString(null)).toBe(false)
      expect(isNonEmptyString(undefined)).toBe(false)
      expect(isNonEmptyString(123)).toBe(false)
      expect(isNonEmptyString([])).toBe(false)
    })
  })

  describe('search', () => {
    it('should find pattern from beginning', () => {
      expect(search('hello world', /world/)).toBe(6)
    })

    it('should find pattern from custom index', () => {
      expect(search('hello hello', /hello/, { fromIndex: 1 })).toBe(6)
    })

    it('should return -1 when pattern not found', () => {
      expect(search('hello', /goodbye/)).toBe(-1)
    })

    it('should handle negative fromIndex', () => {
      expect(search('hello world', /world/, { fromIndex: -5 })).toBe(6)
    })

    it('should return -1 when fromIndex >= length', () => {
      expect(search('hello', /hello/, { fromIndex: 10 })).toBe(-1)
    })

    it('should handle empty string', () => {
      expect(search('', /test/)).toBe(-1)
    })
  })

  describe('stripBom', () => {
    it('should strip BOM from beginning', () => {
      expect(stripBom('\uFEFFhello')).toBe('hello')
    })

    it('should not strip BOM from middle', () => {
      expect(stripBom('hello\uFEFFworld')).toBe('hello\uFEFFworld')
    })

    it('should handle strings without BOM', () => {
      expect(stripBom('hello')).toBe('hello')
    })

    it('should handle empty string', () => {
      expect(stripBom('')).toBe('')
    })
  })

  describe('stringWidth', () => {
    it('should calculate width of ASCII characters', () => {
      expect(stringWidth('hello')).toBe(5)
      expect(stringWidth('test')).toBe(4)
    })

    it('should handle empty string', () => {
      expect(stringWidth('')).toBe(0)
    })

    it('should strip ANSI codes before measuring', () => {
      expect(stringWidth('\x1b[31mred\x1b[0m')).toBe(3)
      expect(stringWidth('\x1b[1;31mbold red\x1b[0m')).toBe(8)
    })

    it('should handle strings with spaces', () => {
      expect(stringWidth('hello world')).toBe(11)
    })

    it('should handle wide characters correctly', () => {
      // CJK characters are typically wide (2 columns)
      expect(stringWidth('你好')).toBeGreaterThanOrEqual(4)
      expect(stringWidth('漢字')).toBeGreaterThanOrEqual(4)
    })

    it('should handle control characters', () => {
      expect(stringWidth('hello\nworld')).toBe(10)
      expect(stringWidth('tab\there')).toBe(7)
    })

    it('should handle emoji correctly', () => {
      // Basic emoji should be 2 columns
      expect(stringWidth('👍')).toBe(2)
      expect(stringWidth('😀')).toBe(2)
      expect(stringWidth('⚡')).toBe(2)
    })

    it('should handle emoji with skin tone modifiers', () => {
      // Emoji with skin tone should still be 2 columns
      expect(stringWidth('👍🏽')).toBe(2)
    })

    it('should handle complex emoji sequences', () => {
      // ZWJ sequences should be 2 columns
      expect(stringWidth('👨‍👩‍👧‍👦')).toBe(2)
    })

    it('should handle combining marks', () => {
      // Base character + combining mark should be width of base
      expect(stringWidth('é')).toBe(1) // precomposed
      expect(stringWidth('e\u0301')).toBe(1) // e + combining acute
    })

    it('should handle zero-width characters', () => {
      expect(stringWidth('hello\u200Bworld')).toBe(10) // zero-width space
      expect(stringWidth('test\uFEFFing')).toBe(7) // zero-width no-break space
    })

    it('should handle fullwidth forms', () => {
      // Fullwidth ASCII should be 2 columns each
      expect(stringWidth('ＡＢＣ')).toBeGreaterThan(3)
    })

    it('should handle halfwidth Katakana', () => {
      // Halfwidth should be 1 column
      expect(stringWidth('ｱｲｳ')).toBe(3)
    })

    it('should return 0 for non-string input', () => {
      expect(stringWidth(null as any)).toBe(0)
      expect(stringWidth(undefined as any)).toBe(0)
      expect(stringWidth(123 as any)).toBe(0)
    })

    it('should handle mixed content', () => {
      const mixed = 'hello 你好 ⚡ world'
      expect(stringWidth(mixed)).toBeGreaterThan(15)
    })

    it('should handle strings with only ANSI codes', () => {
      expect(stringWidth('\x1b[31m\x1b[0m')).toBe(0)
    })

    it('should handle long strings', () => {
      const long = 'a'.repeat(1000)
      expect(stringWidth(long)).toBe(1000)
    })

    it('should handle Greek letters (ambiguous width)', () => {
      // Ambiguous characters treated as narrow (1 column)
      expect(stringWidth('αβγ')).toBe(3)
    })

    it('should handle Cyrillic letters', () => {
      expect(stringWidth('АБВ')).toBe(3)
    })

    it('should handle box drawing characters', () => {
      expect(stringWidth('─│┌')).toBe(3)
    })
  })

  describe('toKebabCase', () => {
    it('should convert camelCase to kebab-case', () => {
      expect(toKebabCase('camelCase')).toBe('camel-case')
      expect(toKebabCase('myVariableName')).toBe('my-variable-name')
    })

    it('should convert snake_case to kebab-case', () => {
      expect(toKebabCase('snake_case')).toBe('snake-case')
      expect(toKebabCase('my_variable_name')).toBe('my-variable-name')
    })

    it('should handle already kebab-case', () => {
      expect(toKebabCase('kebab-case')).toBe('kebab-case')
    })

    it('should handle mixed formats', () => {
      expect(toKebabCase('mixedCase_with_Snake')).toBe('mixed-case-with-snake')
    })

    it('should handle empty string', () => {
      expect(toKebabCase('')).toBe('')
    })

    it('should handle numbers', () => {
      expect(toKebabCase('version2')).toBe('version2')
    })
  })

  describe('trimNewlines', () => {
    it('should trim newlines from both ends', () => {
      expect(trimNewlines('\nhello\n')).toBe('hello')
      expect(trimNewlines('\n\nhello\n\n')).toBe('hello')
    })

    it('should handle carriage returns', () => {
      expect(trimNewlines('\rhello\r')).toBe('hello')
      expect(trimNewlines('\r\nhello\r\n')).toBe('hello')
    })

    it('should not trim newlines from middle', () => {
      expect(trimNewlines('hello\nworld')).toBe('hello\nworld')
    })

    it('should handle strings without newlines', () => {
      expect(trimNewlines('hello')).toBe('hello')
    })

    it('should handle empty string', () => {
      expect(trimNewlines('')).toBe('')
    })

    it('should handle string with only newlines', () => {
      expect(trimNewlines('\n\n')).toBe('')
      expect(trimNewlines('\r\n\r\n')).toBe('')
    })
  })

  describe('repeatString', () => {
    it('should repeat string n times', () => {
      expect(repeatString('x', 3)).toBe('xxx')
      expect(repeatString('ab', 2)).toBe('abab')
    })

    it('should return empty string for count <= 0', () => {
      expect(repeatString('x', 0)).toBe('')
      expect(repeatString('x', -1)).toBe('')
    })

    it('should handle empty string', () => {
      expect(repeatString('', 5)).toBe('')
    })

    it('should handle single repetition', () => {
      expect(repeatString('hello', 1)).toBe('hello')
    })
  })

  describe('centerText', () => {
    it('should center text with even padding', () => {
      expect(centerText('hi', 6)).toBe('  hi  ')
    })

    it('should center text with odd padding', () => {
      expect(centerText('hi', 7)).toBe('  hi   ')
    })

    it('should not pad if text is longer than width', () => {
      expect(centerText('hello', 3)).toBe('hello')
    })

    it('should handle text equal to width', () => {
      expect(centerText('hello', 5)).toBe('hello')
    })

    it('should strip ANSI codes for width calculation', () => {
      const text = '\x1b[31mred\x1b[0m'
      const result = centerText(text, 7)
      // Should center based on visible width (3), not string length
      expect(result.length).toBeGreaterThan(text.length)
    })

    it('should handle empty string', () => {
      expect(centerText('', 5)).toBe('     ')
    })

    it('should handle width of 0', () => {
      expect(centerText('test', 0)).toBe('test')
    })

    it('should handle negative width', () => {
      expect(centerText('test', -5)).toBe('test')
    })
  })

  describe('fromCharCode', () => {
    it('should be exported', () => {
      const { fromCharCode } = require('@socketsecurity/lib/strings')
      expect(typeof fromCharCode).toBe('function')
    })

    it('should convert char codes to strings', () => {
      const { fromCharCode } = require('@socketsecurity/lib/strings')
      expect(fromCharCode(65)).toBe('A')
      expect(fromCharCode(97)).toBe('a')
      expect(fromCharCode(48)).toBe('0')
    })
  })

  describe('edge cases and error handling', () => {
    describe('applyLinePrefix edge cases', () => {
      it('should handle multiple consecutive newlines', () => {
        const result = applyLinePrefix('a\n\n\nb', { prefix: '> ' })
        expect(result).toBe('> a\n> \n> \n> b')
      })

      it('should handle trailing newline', () => {
        const result = applyLinePrefix('hello\n', { prefix: '> ' })
        expect(result).toBe('> hello\n> ')
      })

      it('should handle only newlines', () => {
        const result = applyLinePrefix('\n\n', { prefix: '> ' })
        expect(result).toBe('> \n> \n> ')
      })
    })

    describe('camelToKebab edge cases', () => {
      it('should handle strings with numbers in middle', () => {
        expect(camelToKebab('http2Server')).toBe('http2-server')
        expect(camelToKebab('base64Encode')).toBe('base64-encode')
      })

      it('should handle single uppercase letter', () => {
        expect(camelToKebab('A')).toBe('a')
        expect(camelToKebab('I')).toBe('i')
      })

      it('should handle all uppercase', () => {
        expect(camelToKebab('ALLCAPS')).toBe('allcaps')
      })

      it('should handle mixed case with numbers', () => {
        expect(camelToKebab('HTML5Parser')).toBe('html5-parser')
      })
    })

    describe('indentString edge cases', () => {
      it('should handle count of 0', () => {
        expect(indentString('hello', { count: 0 })).toBe('hello')
      })

      it('should throw on negative count', () => {
        expect(() => indentString('hello', { count: -5 })).toThrow(RangeError)
      })

      it('should handle large count', () => {
        const result = indentString('hi', { count: 100 })
        expect(result).toMatch(/^\s{100}hi$/)
      })

      it('should handle whitespace-only lines correctly', () => {
        const result = indentString('a\n   \nb', { count: 2 })
        expect(result).toBe('  a\n   \n  b')
      })
    })

    describe('search edge cases', () => {
      it('should handle fromIndex at exact match position', () => {
        expect(search('hello', /hello/, { fromIndex: 0 })).toBe(0)
      })

      it('should handle fromIndex past all matches', () => {
        expect(search('hello world', /hello/, { fromIndex: 10 })).toBe(-1)
      })

      it('should handle very negative fromIndex', () => {
        expect(search('hello', /hello/, { fromIndex: -1000 })).toBe(0)
      })

      it('should handle regex with flags', () => {
        expect(search('Hello', /hello/i)).toBe(0)
      })

      it('should handle global regex', () => {
        expect(search('test test', /test/g, { fromIndex: 5 })).toBe(5)
      })
    })

    describe('trimNewlines edge cases', () => {
      it('should handle single character', () => {
        expect(trimNewlines('a')).toBe('a')
        expect(trimNewlines('\n')).toBe('')
        expect(trimNewlines('\r')).toBe('')
      })

      it('should handle mixed line endings', () => {
        expect(trimNewlines('\r\n\nhello\n\r\n')).toBe('hello')
      })

      it('should handle only carriage returns', () => {
        expect(trimNewlines('\r\r\r')).toBe('')
      })

      it('should handle very long strings with newlines', () => {
        const content = 'a'.repeat(1000)
        const input = `\n\n${content}\n\n`
        expect(trimNewlines(input)).toBe(content)
      })
    })

    describe('toKebabCase edge cases', () => {
      it('should handle multiple underscores', () => {
        expect(toKebabCase('foo___bar')).toBe('foo---bar')
      })

      it('should handle trailing underscore', () => {
        expect(toKebabCase('foo_')).toBe('foo-')
      })

      it('should handle leading underscore', () => {
        expect(toKebabCase('_foo')).toBe('-foo')
      })

      it('should handle numbers at end', () => {
        expect(toKebabCase('test123')).toBe('test123')
      })

      it('should handle mixed everything', () => {
        expect(toKebabCase('get_HTML5_Document')).toBe('get-html5-document')
      })

      it('should handle empty string early return', () => {
        // Tests line 731: if (!str.length)
        const result = toKebabCase('')
        expect(result).toBe('')
      })
    })

    describe('camelToKebab additional edge cases', () => {
      it('should handle break condition in inner loop', () => {
        // Tests lines 111-112: if (!char) break
        expect(camelToKebab('Test')).toBe('test')
      })

      it('should handle uppercase sequence collection', () => {
        // Tests lines 124-140: consecutive uppercase handling
        expect(camelToKebab('XMLHTTPRequest')).toBe('xmlhttprequest')
        expect(camelToKebab('IOError')).toBe('ioerror')
      })

      it('should handle non-uppercase continuation', () => {
        // Tests lines 136-139: stop when hitting non-uppercase
        expect(camelToKebab('HTTPSConnection')).toBe('httpsconnection')
      })

      it('should handle mixed case with numbers', () => {
        // Tests lines 141-145: lowercase letters, digits, other chars
        expect(camelToKebab('base64Encode')).toBe('base64-encode')
        expect(camelToKebab('sha256Hash')).toBe('sha256-hash')
      })
    })

    describe('search additional edge cases', () => {
      it('should return -1 when fromIndex >= length', () => {
        // Tests line 311-312: if (fromIndex >= length)
        const result = search('hello', /l/, { fromIndex: 10 })
        expect(result).toBe(-1)
      })

      it('should use fast path when fromIndex === 0', () => {
        // Tests line 314-315: if (fromIndex === 0)
        const result = search('hello world', /world/, { fromIndex: 0 })
        expect(result).toBe(6)
      })
    })

    describe('stringWidth edge cases', () => {
      it('should return 0 for non-string input', () => {
        // Tests line 546-547: typeof check and !text.length
        expect(stringWidth(null)).toBe(0)
        expect(stringWidth(undefined)).toBe(0)
        // @ts-expect-error - Testing runtime behavior with invalid argument type
        expect(stringWidth(123)).toBe(0)
      })

      it('should return 0 for empty string', () => {
        // Tests line 546-547
        expect(stringWidth('')).toBe(0)
      })

      it('should return 0 for string with only ANSI codes', () => {
        // Tests line 555-556: plainText.length check
        expect(stringWidth('\x1b[31m\x1b[0m')).toBe(0)
      })

      it('should skip zero-width clusters', () => {
        // Tests line 604-605: zeroWidthClusterRegex
        expect(stringWidth('hello\u200Bworld')).toBe(10) // Zero-width space
        expect(stringWidth('test\t')).toBe(4) // Tab is control char
      })

      it('should handle RGI emoji as double-width', () => {
        // Tests line 623-625: emojiRegex
        expect(stringWidth('👍')).toBeGreaterThanOrEqual(2)
        expect(stringWidth('😀')).toBeGreaterThanOrEqual(2)
      })

      it('should use East Asian Width for non-emoji', () => {
        // Tests line 639-640: baseSegment and codePointAt
        expect(stringWidth('漢')).toBeGreaterThanOrEqual(2) // CJK
        expect(stringWidth('ｱ')).toBe(1) // Halfwidth Katakana
      })

      it('should handle trailing halfwidth/fullwidth forms', () => {
        // Tests line 678-690: segment.length > 1 and charCode checks
        const textWithHalfwidth = 'aﾞ' // 'a' + halfwidth dakuten
        expect(stringWidth(textWithHalfwidth)).toBeGreaterThanOrEqual(1)
      })
    })

    describe('trimNewlines comprehensive edge cases', () => {
      it('should return empty string for length 0', () => {
        // Tests line 780-781: if (length === 0)
        expect(trimNewlines('')).toBe('')
      })

      it('should handle single newline character', () => {
        // Tests line 785-786: if (length === 1) with newline
        expect(trimNewlines('\n')).toBe('')
        expect(trimNewlines('\r')).toBe('')
      })

      it('should handle single non-newline character', () => {
        // Tests line 785-786: if (length === 1) with non-newline
        expect(trimNewlines('a')).toBe('a')
      })

      it('should return original if no edge newlines', () => {
        // Tests line 790-791: noFirstNewline && noLastNewline
        expect(trimNewlines('hello')).toBe('hello')
        expect(trimNewlines('a\nb')).toBe('a\nb')
      })

      it('should handle newlines at start', () => {
        // Tests line 795-800: while loop for start
        expect(trimNewlines('\n\r\nhello')).toBe('hello')
      })

      it('should handle newlines at end', () => {
        // Tests line 802-807: while loop for end
        expect(trimNewlines('hello\r\n\n')).toBe('hello')
      })

      it('should handle newlines at both ends', () => {
        // Tests both loops
        expect(trimNewlines('\r\n\rhello\n\r')).toBe('hello')
      })
    })

    describe('centerText edge cases', () => {
      it('should return original text when >= width', () => {
        // Tests line 882: if (textLength >= width)
        expect(centerText('hello', 5)).toBe('hello')
        expect(centerText('hello', 3)).toBe('hello')
        expect(centerText('longer text', 5)).toBe('longer text')
      })

      it('should center text with odd padding', () => {
        // Tests padding calculation
        expect(centerText('hi', 5)).toBe(' hi  ')
        expect(centerText('a', 7)).toBe('   a   ')
      })

      it('should center text with even padding', () => {
        expect(centerText('test', 8)).toBe('  test  ')
      })
    })

    describe('indentString edge cases', () => {
      it('should handle empty lines correctly', () => {
        // Tests line 186-187: regex with empty line handling
        const result = indentString('line1\n\nline3', { count: 2 })
        expect(result).toBe('  line1\n\n  line3')
      })

      it('should use default count of 1', () => {
        const result = indentString('hello')
        expect(result).toBe(' hello')
      })

      it('should handle large count values', () => {
        const result = indentString('test', { count: 10 })
        expect(result).toBe(`${' '.repeat(10)}test`)
      })
    })

    describe('isBlankString edge cases', () => {
      it('should handle various whitespace types', () => {
        // Tests line 223: /^\s+$/.test(value)
        expect(isBlankString(' \t\n\r ')).toBe(true)
        expect(isBlankString('\n\n\n')).toBe(true)
        expect(isBlankString('\t\t\t')).toBe(true)
      })

      it('should return false for non-blank strings', () => {
        expect(isBlankString(' a ')).toBe(false)
        expect(isBlankString('  \n  x  ')).toBe(false)
      })

      it('should handle non-string types', () => {
        expect(isBlankString(null)).toBe(false)
        expect(isBlankString(undefined)).toBe(false)
        expect(isBlankString(123)).toBe(false)
        expect(isBlankString({})).toBe(false)
      })
    })
  })
})
