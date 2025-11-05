/**
 * @fileoverview Unit tests for JSON validation and parsing utilities.
 *
 * Tests secure JSON parsing with protection against common vulnerabilities:
 * - safeJsonParse() blocks prototype pollution attacks (__proto__, constructor, prototype)
 * - tryJsonParse() provides non-throwing JSON parsing with undefined fallback
 * - Size limit enforcement to prevent DoS attacks via massive JSON payloads
 * - Reviver function support for custom parsing logic
 * - Handles malformed JSON, nested objects, and edge cases
 * - Validates security controls work correctly while allowing legitimate data
 */

import {
  safeJsonParse,
  tryJsonParse,
} from '@socketsecurity/lib/validation/json-parser'
import { describe, expect, it } from 'vitest'

describe('validation/json-parser', () => {
  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJsonParse('{"name":"test","value":123}')
      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should parse JSON arrays', () => {
      const result = safeJsonParse('[1,2,3,4,5]')
      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('should parse JSON primitives', () => {
      expect(safeJsonParse('true')).toBe(true)
      expect(safeJsonParse('false')).toBe(false)
      expect(safeJsonParse('null')).toBe(null)
      expect(safeJsonParse('42')).toBe(42)
      expect(safeJsonParse('"string"')).toBe('string')
    })

    it('should throw on invalid JSON', () => {
      expect(() => safeJsonParse('invalid json')).toThrow()
      expect(() => safeJsonParse('{invalid}')).toThrow()
    })

    it('should throw on prototype pollution attempts', () => {
      expect(() => safeJsonParse('{"__proto__":{"isAdmin":true}}')).toThrow(
        /prototype pollution/,
      )
      expect(() => safeJsonParse('{"constructor":{"key":"value"}}')).toThrow(
        /prototype pollution/,
      )
      expect(() => safeJsonParse('{"prototype":{"key":"value"}}')).toThrow(
        /prototype pollution/,
      )
    })

    it('should allow prototype keys when allowPrototype is true', () => {
      const result = safeJsonParse('{"__proto__":{"test":true}}', undefined, {
        allowPrototype: true,
      })
      expect(result).toBeDefined()
    })

    it('should throw on size limit exceeded', () => {
      const largeJson = JSON.stringify({ data: 'x'.repeat(1000) })
      expect(() =>
        safeJsonParse(largeJson, undefined, { maxSize: 100 }),
      ).toThrow(/exceeds maximum size/)
    })

    it('should accept JSON within size limit', () => {
      const smallJson = JSON.stringify({ data: 'test' })
      const result = safeJsonParse(smallJson, undefined, { maxSize: 1000 })
      expect(result).toEqual({ data: 'test' })
    })

    it('should handle nested objects', () => {
      const json = '{"level1":{"level2":{"level3":"value"}}}'
      const result = safeJsonParse(json)
      expect(result).toEqual({ level1: { level2: { level3: 'value' } } })
    })

    it('should handle arrays in objects', () => {
      const json = '{"items":[1,2,3],"nested":{"arr":[4,5,6]}}'
      const result = safeJsonParse(json)
      expect(result).toEqual({
        items: [1, 2, 3],
        nested: { arr: [4, 5, 6] },
      })
    })

    it('should handle empty objects and arrays', () => {
      expect(safeJsonParse('{}')).toEqual({})
      expect(safeJsonParse('[]')).toEqual([])
    })
  })

  describe('tryJsonParse', () => {
    it('should parse valid JSON', () => {
      const result = tryJsonParse('{"name":"test"}')
      expect(result).toEqual({ name: 'test' })
    })

    it('should return undefined on invalid JSON', () => {
      const result = tryJsonParse('invalid json')
      expect(result).toBeUndefined()
    })

    it('should return undefined on prototype pollution', () => {
      const result = tryJsonParse('{"__proto__":{"isAdmin":true}}')
      expect(result).toBeUndefined()
    })

    it('should return undefined on size limit exceeded', () => {
      const largeJson = JSON.stringify({ data: 'x'.repeat(1000) })
      const result = tryJsonParse(largeJson, undefined, { maxSize: 100 })
      expect(result).toBeUndefined()
    })

    it('should successfully parse within limits', () => {
      const result = tryJsonParse('{"test":true}')
      expect(result).toEqual({ test: true })
    })
  })

  describe('error handling with tryJsonParse', () => {
    it('should return undefined for various error conditions', () => {
      // Already covered in tryJsonParse tests above
      expect(tryJsonParse('invalid')).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle deeply nested JSON', () => {
      const json = '{"a":{"b":{"c":{"d":{"e":"value"}}}}}'
      const result = safeJsonParse(json)
      expect(result).toEqual({ a: { b: { c: { d: { e: 'value' } } } } })
    })

    it('should handle special characters', () => {
      const json = '{"text":"hello\\nworld\\t!"}'
      const result = safeJsonParse(json)
      expect(result).toEqual({ text: 'hello\nworld\t!' })
    })

    it('should handle unicode', () => {
      const json = '{"emoji":"😀","chinese":"你好"}'
      const result = safeJsonParse(json)
      expect(result).toEqual({ emoji: '😀', chinese: '你好' })
    })

    it('should handle numbers correctly', () => {
      const json = '{"int":42,"float":3.14,"neg":-1,"exp":1e10}'
      const result = safeJsonParse(json)
      expect(result).toEqual({ int: 42, float: 3.14, neg: -1, exp: 1e10 })
    })

    it('should handle mixed arrays', () => {
      const json = '[1,"string",true,null,{"obj":true}]'
      const result = safeJsonParse(json)
      expect(result).toEqual([1, 'string', true, null, { obj: true }])
    })
  })
})
