/**
 * @fileoverview Unit tests for JSON parsing utilities.
 *
 * Tests JSON parsing with Buffer support and BOM handling:
 * - jsonParse() parses JSON strings or UTF-8 Buffers with automatic BOM stripping
 * - isJsonPrimitive() type guard for null, boolean, number, string
 * - Buffer detection via duck-typing (checks length, copy, slice, constructor.isBuffer)
 * - BOM (Byte Order Mark U+FEFF) stripped from beginning of input
 * - Optional filepath for enhanced error messages ("/path/to/file.json: Unexpected token...")
 * - Optional reviver function for custom value transformations
 * - Optional throws flag to return undefined instead of throwing on errors
 * Tests cover valid/invalid JSON, Buffer encoding, error handling, revivers, and edge cases
 * including empty strings, special characters, unicode, and very large JSON payloads.
 */

import { isJsonPrimitive, jsonParse } from '@socketsecurity/lib/json'
import { describe, expect, it } from 'vitest'

describe('json', () => {
  describe('isJsonPrimitive', () => {
    it('should return true for null', () => {
      expect(isJsonPrimitive(null)).toBe(true)
    })

    it('should return true for boolean values', () => {
      expect(isJsonPrimitive(true)).toBe(true)
      expect(isJsonPrimitive(false)).toBe(true)
    })

    it('should return true for numbers', () => {
      expect(isJsonPrimitive(0)).toBe(true)
      expect(isJsonPrimitive(42)).toBe(true)
      expect(isJsonPrimitive(-1)).toBe(true)
      expect(isJsonPrimitive(3.14)).toBe(true)
      expect(isJsonPrimitive(Number.NaN)).toBe(true)
      expect(isJsonPrimitive(Number.POSITIVE_INFINITY)).toBe(true)
      expect(isJsonPrimitive(Number.NEGATIVE_INFINITY)).toBe(true)
    })

    it('should return true for strings', () => {
      expect(isJsonPrimitive('')).toBe(true)
      expect(isJsonPrimitive('hello')).toBe(true)
      expect(isJsonPrimitive('123')).toBe(true)
    })

    it('should return false for undefined', () => {
      expect(isJsonPrimitive(undefined)).toBe(false)
    })

    it('should return false for objects', () => {
      expect(isJsonPrimitive({})).toBe(false)
      expect(isJsonPrimitive({ key: 'value' })).toBe(false)
    })

    it('should return false for arrays', () => {
      expect(isJsonPrimitive([])).toBe(false)
      expect(isJsonPrimitive([1, 2, 3])).toBe(false)
    })

    it('should return false for functions', () => {
      expect(isJsonPrimitive(() => {})).toBe(false)
    })

    it('should return false for symbols', () => {
      expect(isJsonPrimitive(Symbol('test'))).toBe(false)
    })

    it('should return false for BigInt', () => {
      expect(isJsonPrimitive(BigInt(123))).toBe(false)
    })
  })

  describe('jsonParse', () => {
    describe('valid JSON parsing', () => {
      it('should parse valid JSON string', () => {
        const result = jsonParse('{"key":"value"}')
        expect(result).toEqual({ key: 'value' })
      })

      it('should parse JSON array', () => {
        const result = jsonParse('[1,2,3]')
        expect(result).toEqual([1, 2, 3])
      })

      it('should parse JSON primitives', () => {
        expect(jsonParse('null')).toBe(null)
        expect(jsonParse('true')).toBe(true)
        expect(jsonParse('false')).toBe(false)
        expect(jsonParse('42')).toBe(42)
        expect(jsonParse('"string"')).toBe('string')
      })

      it('should parse nested JSON objects', () => {
        const json = '{"nested":{"key":"value"},"array":[1,2,3]}'
        const result = jsonParse(json)
        expect(result).toEqual({
          nested: { key: 'value' },
          array: [1, 2, 3],
        })
      })

      it('should parse empty object', () => {
        expect(jsonParse('{}')).toEqual({})
      })

      it('should parse empty array', () => {
        expect(jsonParse('[]')).toEqual([])
      })

      it('should parse JSON with whitespace', () => {
        const result = jsonParse('  { "key" : "value" }  ')
        expect(result).toEqual({ key: 'value' })
      })

      it('should parse JSON with newlines', () => {
        const json = `{
          "key": "value",
          "number": 42
        }`
        const result = jsonParse(json)
        expect(result).toEqual({ key: 'value', number: 42 })
      })
    })

    describe('Buffer support', () => {
      it('should parse JSON from Buffer', () => {
        const buffer = Buffer.from('{"key":"value"}', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual({ key: 'value' })
      })

      it('should parse JSON from Buffer with UTF-8 encoding', () => {
        const buffer = Buffer.from('[1,2,3]', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual([1, 2, 3])
      })

      it('should handle Buffer with BOM', () => {
        const buffer = Buffer.from('\uFEFF{"key":"value"}', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual({ key: 'value' })
      })

      it('should parse empty Buffer', () => {
        const buffer = Buffer.from('null', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toBe(null)
      })

      it('should handle empty Buffer content', () => {
        const buffer = Buffer.from('{}', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual({})
      })

      it('should handle Buffer with nested objects', () => {
        const buffer = Buffer.from('{"a":{"b":{"c":1}}}', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual({ a: { b: { c: 1 } } })
      })

      it('should handle Buffer with array content', () => {
        const buffer = Buffer.from('["a","b","c"]', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual(['a', 'b', 'c'])
      })

      it('should handle Buffer with number content', () => {
        const buffer = Buffer.from('42', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toBe(42)
      })

      it('should handle Buffer with boolean content', () => {
        const buffer = Buffer.from('true', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toBe(true)
      })

      it('should handle Buffer with string content', () => {
        const buffer = Buffer.from('"hello world"', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toBe('hello world')
      })

      it('should throw error for invalid JSON in Buffer', () => {
        const buffer = Buffer.from('invalid json', 'utf8')
        expect(() => jsonParse(buffer)).toThrow()
      })

      it('should return undefined for invalid JSON in Buffer with throws false', () => {
        const buffer = Buffer.from('invalid json', 'utf8')
        const result = jsonParse(buffer, { throws: false })
        expect(result).toBe(undefined)
      })

      it('should handle Buffer with reviver', () => {
        const buffer = Buffer.from('{"num":10}', 'utf8')
        const reviver = (_key: string, value: unknown) => {
          if (typeof value === 'number') {
            return value * 2
          }
          return value
        }
        const result = jsonParse(buffer, { reviver })
        expect(result).toEqual({ num: 20 })
      })

      it('should handle Buffer with filepath option', () => {
        const buffer = Buffer.from('invalid', 'utf8')
        try {
          jsonParse(buffer, { filepath: '/test/buffer.json' })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).toContain('/test/buffer.json')
        }
      })

      it('should handle Buffer with all options', () => {
        const buffer = Buffer.from('{"value":5}', 'utf8')
        const reviver = (_key: string, value: unknown) => value
        const result = jsonParse(buffer, {
          filepath: '/test.json',
          reviver,
          throws: true,
        })
        expect(result).toEqual({ value: 5 })
      })
    })

    describe('BOM stripping', () => {
      it('should strip BOM from beginning of string', () => {
        const result = jsonParse('\uFEFF{"key":"value"}')
        expect(result).toEqual({ key: 'value' })
      })

      it('should strip BOM from array', () => {
        const result = jsonParse('\uFEFF[1,2,3]')
        expect(result).toEqual([1, 2, 3])
      })

      it('should handle string without BOM', () => {
        const result = jsonParse('{"key":"value"}')
        expect(result).toEqual({ key: 'value' })
      })
    })

    describe('reviver function', () => {
      it('should use reviver function to transform values', () => {
        const reviver = (_key: string, value: unknown) => {
          if (typeof value === 'number') {
            return value * 2
          }
          return value
        }
        const result = jsonParse('{"a":1,"b":2}', { reviver })
        expect(result).toEqual({ a: 2, b: 4 })
      })

      it('should pass key to reviver', () => {
        const keys: string[] = []
        const reviver = (key: string, value: unknown) => {
          keys.push(key)
          return value
        }
        jsonParse('{"a":1}', { reviver })
        expect(keys).toContain('a')
        expect(keys).toContain('')
      })

      it('should allow reviver to filter values', () => {
        const reviver = (key: string, value: unknown) => {
          if (key === 'filter') {
            return undefined
          }
          return value
        }
        const result = jsonParse('{"keep":"yes","filter":"no"}', { reviver })
        expect(result).toEqual({ keep: 'yes' })
      })

      it('should handle reviver with nested objects', () => {
        const reviver = (key: string, value: unknown) => {
          if (key === 'nested' && typeof value === 'object') {
            return 'replaced'
          }
          return value
        }
        const result = jsonParse('{"nested":{"key":"value"}}', { reviver })
        expect(result).toEqual({ nested: 'replaced' })
      })
    })

    describe('error handling with throws option', () => {
      it('should throw error for invalid JSON by default', () => {
        expect(() => jsonParse('invalid json')).toThrow()
      })

      it('should throw error when throws is true', () => {
        expect(() => jsonParse('invalid json', { throws: true })).toThrow()
      })

      it('should throw error when throws is explicitly undefined', () => {
        expect(() => jsonParse('invalid json', { throws: undefined })).toThrow()
      })

      it('should return undefined when throws is false', () => {
        const result = jsonParse('invalid json', { throws: false })
        expect(result).toBe(undefined)
      })

      it('should throw for malformed JSON object', () => {
        expect(() => jsonParse('{invalid}')).toThrow()
      })

      it('should throw for unclosed JSON object', () => {
        expect(() => jsonParse('{"key":"value"')).toThrow()
      })

      it('should throw for unclosed JSON array', () => {
        expect(() => jsonParse('[1,2,3')).toThrow()
      })

      it('should throw for trailing comma', () => {
        expect(() => jsonParse('{"key":"value",}')).toThrow()
      })

      it('should throw for single quotes', () => {
        expect(() => jsonParse("{'key':'value'}")).toThrow()
      })

      it('should return undefined for empty string with throws false', () => {
        const result = jsonParse('', { throws: false })
        expect(result).toBe(undefined)
      })

      it('should throw for empty string by default', () => {
        expect(() => jsonParse('')).toThrow()
      })
    })

    describe('error handling with filepath option', () => {
      it('should include filepath in error message', () => {
        const filepath = '/path/to/file.json'
        try {
          jsonParse('invalid json', { filepath })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).toContain(filepath)
        }
      })

      it('should prepend filepath to error message', () => {
        const filepath = '/test/file.json'
        try {
          jsonParse('{invalid}', { filepath })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).toMatch(/^\/test\/file\.json:/)
        }
      })

      it('should work with Buffer and filepath', () => {
        const buffer = Buffer.from('invalid json', 'utf8')
        const filepath = '/path/to/buffer.json'
        try {
          jsonParse(buffer, { filepath })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).toContain(filepath)
        }
      })

      it('should not modify error when throws is false', () => {
        const result = jsonParse('invalid', {
          filepath: '/test.json',
          throws: false,
        })
        expect(result).toBe(undefined)
      })

      it('should handle empty filepath', () => {
        try {
          jsonParse('invalid', { filepath: '' })
          expect.fail('Should have thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(Error)
        }
      })
    })

    describe('combined options', () => {
      it('should use reviver with filepath', () => {
        const reviver = (_key: string, value: unknown) => value
        const result = jsonParse('{"key":"value"}', {
          filepath: '/test.json',
          reviver,
        })
        expect(result).toEqual({ key: 'value' })
      })

      it('should use reviver with throws false', () => {
        const reviver = (_key: string, value: unknown) => value
        const result = jsonParse('{"key":"value"}', {
          throws: false,
          reviver,
        })
        expect(result).toEqual({ key: 'value' })
      })

      it('should use all options together', () => {
        const reviver = (_key: string, value: unknown) => value
        const result = jsonParse('{"key":"value"}', {
          filepath: '/test.json',
          throws: true,
          reviver,
        })
        expect(result).toEqual({ key: 'value' })
      })

      it('should handle error with all options', () => {
        const reviver = (_key: string, value: unknown) => value
        const result = jsonParse('invalid', {
          filepath: '/test.json',
          throws: false,
          reviver,
        })
        expect(result).toBe(undefined)
      })
    })

    describe('edge cases', () => {
      it('should parse JSON with special characters', () => {
        const json = '{"special":"\\n\\t\\r\\b\\f\\"\\\\/"}'
        const result = jsonParse(json)
        expect(result).toEqual({ special: '\n\t\r\b\f"\\/' })
      })

      it('should parse JSON with unicode escapes', () => {
        const json = '{"unicode":"\\u0048\\u0065\\u006c\\u006c\\u006f"}'
        const result = jsonParse(json)
        expect(result).toEqual({ unicode: 'Hello' })
      })

      it('should parse JSON with negative numbers', () => {
        const result = jsonParse('{"negative":-42}')
        expect(result).toEqual({ negative: -42 })
      })

      it('should parse JSON with scientific notation', () => {
        const result = jsonParse('{"scientific":1.23e10}')
        expect(result).toEqual({ scientific: 1.23e10 })
      })

      it('should parse JSON with very nested structure', () => {
        const json = '{"a":{"b":{"c":{"d":{"e":"deep"}}}}}'
        const result = jsonParse(json)
        expect(result).toEqual({ a: { b: { c: { d: { e: 'deep' } } } } })
      })

      it('should parse large array', () => {
        const array = Array.from({ length: 1000 }, (_, i) => i)
        const json = JSON.stringify(array)
        const result = jsonParse(json)
        expect(result).toEqual(array)
      })

      it('should handle JSON with null values', () => {
        const result = jsonParse('{"key":null}')
        expect(result).toEqual({ key: null })
      })

      it('should handle mixed types in array', () => {
        const result = jsonParse(
          '[null,true,42,"string",{"key":"value"},[1,2]]',
        )
        expect(result).toEqual([
          null,
          true,
          42,
          'string',
          { key: 'value' },
          [1, 2],
        ])
      })

      it('should handle zero', () => {
        expect(jsonParse('0')).toBe(0)
        expect(jsonParse('-0')).toBe(-0)
      })

      it('should handle empty string value', () => {
        const result = jsonParse('{"empty":""}')
        expect(result).toEqual({ empty: '' })
      })
    })

    describe('options object behavior', () => {
      it('should work with empty options object', () => {
        const result = jsonParse('{"key":"value"}', {})
        expect(result).toEqual({ key: 'value' })
      })

      it('should work without options', () => {
        const result = jsonParse('{"key":"value"}')
        expect(result).toEqual({ key: 'value' })
      })

      it('should work with undefined options', () => {
        const result = jsonParse('{"key":"value"}', undefined)
        expect(result).toEqual({ key: 'value' })
      })

      it('should work with throws explicitly set to true', () => {
        const result = jsonParse('{"key":"value"}', { throws: true })
        expect(result).toEqual({ key: 'value' })
      })

      it('should work with throws explicitly set to false', () => {
        const result = jsonParse('{"key":"value"}', { throws: false })
        expect(result).toEqual({ key: 'value' })
      })

      it('should work with only reviver option', () => {
        const reviver = (_key: string, value: unknown) => value
        const result = jsonParse('{"key":"value"}', { reviver })
        expect(result).toEqual({ key: 'value' })
      })

      it('should work with only filepath option', () => {
        const result = jsonParse('{"key":"value"}', { filepath: '/test.json' })
        expect(result).toEqual({ key: 'value' })
      })

      it('should work with only throws option', () => {
        const result = jsonParse('{"key":"value"}', { throws: false })
        expect(result).toEqual({ key: 'value' })
      })
    })

    describe('string vs Buffer edge cases', () => {
      it('should handle string with special unicode characters', () => {
        const result = jsonParse('{"emoji":"😀"}')
        expect(result).toEqual({ emoji: '😀' })
      })

      it('should handle Buffer with special unicode characters', () => {
        const buffer = Buffer.from('{"emoji":"😀"}', 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual({ emoji: '😀' })
      })

      it('should handle string with escaped unicode', () => {
        const result = jsonParse('{"escaped":"\\u0041\\u0042\\u0043"}')
        expect(result).toEqual({ escaped: 'ABC' })
      })

      it('should handle Buffer with escaped unicode', () => {
        const buffer = Buffer.from(
          '{"escaped":"\\u0041\\u0042\\u0043"}',
          'utf8',
        )
        const result = jsonParse(buffer)
        expect(result).toEqual({ escaped: 'ABC' })
      })

      it('should handle very long JSON string', () => {
        const longArray = Array.from({ length: 10_000 }, (_, i) => i)
        const json = JSON.stringify(longArray)
        const result = jsonParse(json)
        expect(result).toEqual(longArray)
      })

      it('should handle very long JSON Buffer', () => {
        const longArray = Array.from({ length: 10_000 }, (_, i) => i)
        const json = JSON.stringify(longArray)
        const buffer = Buffer.from(json, 'utf8')
        const result = jsonParse(buffer)
        expect(result).toEqual(longArray)
      })

      it('should handle whitespace-only JSON with BOM', () => {
        const result = jsonParse('\uFEFF   "value"   ')
        expect(result).toBe('value')
      })

      it('should handle Buffer with multiple BOMs in content', () => {
        // Only the first BOM should be stripped
        const buffer = Buffer.from(
          '\uFEFF{"text":"\\uFEFF embedded BOM"}',
          'utf8',
        )
        const result = jsonParse(buffer)
        expect(result).toEqual({ text: '\uFEFF embedded BOM' })
      })
    })

    describe('error message formatting', () => {
      it('should preserve original error type', () => {
        try {
          jsonParse('invalid')
          expect.fail('Should have thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(SyntaxError)
        }
      })

      it('should preserve original error for Buffer', () => {
        const buffer = Buffer.from('invalid', 'utf8')
        try {
          jsonParse(buffer)
          expect.fail('Should have thrown')
        } catch (e) {
          expect(e).toBeInstanceOf(SyntaxError)
        }
      })

      it('should handle filepath with special characters', () => {
        try {
          jsonParse('invalid', { filepath: '/path/with spaces/file.json' })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).toContain('/path/with spaces/file.json')
        }
      })

      it('should handle very long filepath', () => {
        const longPath = `/very/long/path/${'a'.repeat(1000)}/file.json`
        try {
          jsonParse('invalid', { filepath: longPath })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).toContain(longPath)
        }
      })

      it('should not modify error when filepath is undefined', () => {
        try {
          jsonParse('invalid', { filepath: undefined })
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as Error).message).not.toContain('undefined')
        }
      })
    })

    describe('isBuffer internal function edge cases', () => {
      it('should handle falsy values that are not Buffers', () => {
        // Tests line 156: if (!x || typeof x !== 'object')
        expect(jsonParse('null')).toBe(null)
        expect(jsonParse('false')).toBe(false)
        expect(jsonParse('0')).toBe(0)
      })

      it('should handle objects without length property', () => {
        // Tests line 160-161: typeof obj['length'] !== 'number'
        // jsonParse with an object that looks nothing like a Buffer should fail gracefully
        expect(() => {
          // @ts-expect-error - testing runtime behavior with invalid input
          jsonParse({ some: 'object' })
        }).toThrow()
      })

      it('should handle objects with non-number length', () => {
        // Tests line 160-161: typeof obj['length'] !== 'number'
        expect(() => {
          // @ts-expect-error - testing runtime behavior
          jsonParse({ length: 'not a number' })
        }).toThrow()
      })

      it('should handle objects missing copy/slice methods', () => {
        // Tests line 163-164: missing copy or slice methods
        expect(() => {
          // @ts-expect-error - testing runtime behavior
          jsonParse({ length: 10 })
        }).toThrow()

        expect(() => {
          // @ts-expect-error - testing runtime behavior
          jsonParse({ length: 10, copy: 'not a function' })
        }).toThrow()

        expect(() => {
          // @ts-expect-error - testing runtime behavior
          jsonParse({ length: 10, slice: 'not a function' })
        }).toThrow()
      })

      it('should handle array-like objects with non-number first element', () => {
        // Tests line 166-171: length > 0 but obj[0] is not a number
        expect(() => {
          jsonParse({
            length: 1,
            0: 'not a number',
            // @ts-expect-error - Testing Buffer-like object with invalid method signatures
            copy: () => {},
            // @ts-expect-error - Testing Buffer-like object with invalid method signatures
            slice: () => {},
          })
        }).toThrow()
      })

      it('should handle objects without proper constructor', () => {
        // Tests line 174-177: constructor.isBuffer checks
        expect(() => {
          jsonParse({
            length: 0,
            // @ts-expect-error - Testing Buffer-like object with invalid method signatures
            copy: () => {},
            // @ts-expect-error - Testing Buffer-like object with invalid method signatures
            slice: () => {},
            // @ts-expect-error - Testing Buffer-like object with missing isBuffer method
            constructor: {}, // No isBuffer method
          })
        }).toThrow()

        expect(() => {
          jsonParse({
            length: 0,
            // @ts-expect-error - Testing Buffer-like object with invalid method signatures
            copy: () => {},
            // @ts-expect-error - Testing Buffer-like object with invalid method signatures
            slice: () => {},
            constructor: {
              // @ts-expect-error - Testing Buffer-like object with non-function isBuffer
              isBuffer: 'not a function',
            },
          })
        }).toThrow()
      })
    })

    describe('isJsonPrimitive edge cases', () => {
      it('should handle all falsy values correctly', () => {
        // Tests line 200: value === null
        expect(isJsonPrimitive(null)).toBe(true)
        expect(isJsonPrimitive(undefined)).toBe(false)
        expect(isJsonPrimitive(0)).toBe(true)
        expect(isJsonPrimitive(false)).toBe(true)
        expect(isJsonPrimitive('')).toBe(true)
        expect(isJsonPrimitive(Number.NaN)).toBe(true) // NaN is a number
      })

      it('should handle special number values', () => {
        expect(isJsonPrimitive(Number.POSITIVE_INFINITY)).toBe(true)
        expect(isJsonPrimitive(Number.NEGATIVE_INFINITY)).toBe(true)
        expect(isJsonPrimitive(Number.MAX_VALUE)).toBe(true)
        expect(isJsonPrimitive(Number.MIN_VALUE)).toBe(true)
      })
    })
  })
})
