/**
 * @fileoverview Unit tests for Zod schema validation library wrapper.
 *
 * Tests Zod validation library re-export:
 * - z object export for schema building
 * - String, number, boolean, array, object schemas
 * - Type inference from schemas
 * - Parse validation and error handling
 * - Used as centralized import point for Zod in Socket tools
 * Ensures consistent Zod version across all Socket packages.
 */

import { describe, expect, it } from 'vitest'

import { z } from '@socketsecurity/lib/zod'

describe('zod', () => {
  describe('z export', () => {
    it('should export z object', () => {
      expect(z).toBeDefined()
      expect(typeof z).toBe('object')
    })

    it('should export string schema builder', () => {
      expect(typeof z.string).toBe('function')
      const schema = z.string()
      expect(schema.parse('test')).toBe('test')
    })

    it('should export number schema builder', () => {
      expect(typeof z.number).toBe('function')
      const schema = z.number()
      expect(schema.parse(123)).toBe(123)
    })

    it('should export boolean schema builder', () => {
      expect(typeof z.boolean).toBe('function')
      const schema = z.boolean()
      expect(schema.parse(true)).toBe(true)
    })

    it('should export object schema builder', () => {
      expect(typeof z.object).toBe('function')
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })
      expect(schema.parse({ name: 'test', age: 25 })).toEqual({
        name: 'test',
        age: 25,
      })
    })

    it('should export array schema builder', () => {
      expect(typeof z.array).toBe('function')
      const schema = z.array(z.string())
      expect(schema.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    })

    it('should validate and throw on invalid data', () => {
      const schema = z.string()
      expect(() => schema.parse(123)).toThrow()
    })

    it('should support optional fields', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      })
      expect(schema.parse({ name: 'test' })).toEqual({ name: 'test' })
      expect(schema.parse({ name: 'test', age: 25 })).toEqual({
        name: 'test',
        age: 25,
      })
    })

    it('should support default values', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().default(0),
      })
      expect(schema.parse({ name: 'test' })).toEqual({ name: 'test', age: 0 })
    })

    it('should support unions', () => {
      const schema = z.union([z.string(), z.number()])
      expect(schema.parse('test')).toBe('test')
      expect(schema.parse(123)).toBe(123)
      expect(() => schema.parse(true)).toThrow()
    })

    it('should support enums', () => {
      const schema = z.enum(['red', 'green', 'blue'])
      expect(schema.parse('red')).toBe('red')
      expect(() => schema.parse('yellow')).toThrow()
    })

    it('should support literal values', () => {
      const schema = z.literal('hello')
      expect(schema.parse('hello')).toBe('hello')
      expect(() => schema.parse('world')).toThrow()
    })

    it('should support refinements', () => {
      const schema = z.string().refine(val => val.length > 3, {
        message: 'String must be longer than 3 characters',
      })
      expect(schema.parse('test')).toBe('test')
      expect(() => schema.parse('ab')).toThrow()
    })

    it('should support transformations', () => {
      const schema = z.string().transform(val => val.toUpperCase())
      expect(schema.parse('test')).toBe('TEST')
    })

    it('should support nested objects', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      })
      expect(
        schema.parse({ user: { name: 'test', email: 'test@example.com' } }),
      ).toEqual({ user: { name: 'test', email: 'test@example.com' } })
    })

    it('should support safeParse for non-throwing validation', () => {
      const schema = z.string()
      const result1 = schema.safeParse('test')
      expect(result1.success).toBe(true)
      if (result1.success) {
        expect(result1.data).toBe('test')
      }

      const result2 = schema.safeParse(123)
      expect(result2.success).toBe(false)
    })
  })
})
