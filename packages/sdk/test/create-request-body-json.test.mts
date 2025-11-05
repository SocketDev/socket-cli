/** @fileoverview Tests for JSON request body creation utilities. */
import { describe, expect, it } from 'vitest'

import { createRequestBodyForJson } from '../src/index'

describe('JSON Request Body Creation', () => {
  describe('createRequestBodyForJson', () => {
    it('should create request body for JSON data with default basename', () => {
      const jsonData = { test: 'data', number: 42 }
      const result = createRequestBodyForJson(jsonData)

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="data"')
      expect(result[0]).toContain('filename="data.json"')
      expect(result[0]).toContain('Content-Type: application/json')
      expect(result[2]).toBe('\r\n')
    })

    it('should create request body for JSON data with custom basename', () => {
      const jsonData = { custom: true }
      const result = createRequestBodyForJson(jsonData, 'custom-file.json')

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="custom-file"')
      expect(result[0]).toContain('filename="custom-file.json"')
      expect(result[0]).toContain('Content-Type: application/json')
    })

    it('should handle basename without extension', () => {
      const jsonData = { test: 'no-ext' }
      const result = createRequestBodyForJson(jsonData, 'noextension')

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="noextension"')
      expect(result[0]).toContain('filename="noextension"')
      expect(result[0]).toContain('Content-Type: application/json')
    })

    it('should handle complex JSON data', () => {
      const jsonData = {
        nested: { object: true },
        array: [1, 2, 3],
        string: 'test',
        number: 123.45,
        boolean: false,
        null: null,
      }
      const result = createRequestBodyForJson(jsonData, 'complex.json')

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="complex"')
      expect(result[0]).toContain('filename="complex.json"')
      expect(result[0]).toContain('Content-Type: application/json')
    })

    it('should handle empty object', () => {
      const jsonData = {}
      const result = createRequestBodyForJson(jsonData, 'empty.json')

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="empty"')
      expect(result[0]).toContain('filename="empty.json"')
    })

    it('should handle null data', () => {
      const jsonData = null
      const result = createRequestBodyForJson(jsonData, 'null.json')

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="null"')
      expect(result[0]).toContain('filename="null.json"')
    })

    it('should handle different file extensions', () => {
      const jsonData = { test: true }
      const result = createRequestBodyForJson(jsonData, 'data.manifest')

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('name="data"')
      expect(result[0]).toContain('filename="data.manifest"')
    })
  })
})
