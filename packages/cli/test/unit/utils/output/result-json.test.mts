/**
 * Unit tests for JSON result formatting.
 *
 * Purpose:
 * Tests JSON result formatting. Validates CResult conversion to JSON and error serialization.
 *
 * Test Coverage:
 * - CResult to JSON conversion
 * - Error serialization
 * - Data sanitization
 * - Nested object handling
 * - Pretty printing options
 *
 * Testing Approach:
 * Tests JSON output formatting with CResult patterns.
 *
 * Related Files:
 * - utils/output/result-json.mts (implementation)
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { serializeResultJson } from '../../../../src/utils/output/result-json.mts'

describe('serializeResultJson', () => {
  afterEach(() => {
    // Reset exitCode after each test.
    process.exitCode = undefined
  })

  it('serializes simple objects', () => {
    const result = serializeResultJson({ ok: true, data: 'test' })
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(parsed.data).toBe('test')
  })

  it('serializes complex nested objects', () => {
    const data = {
      ok: true,
      data: {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        metadata: {
          count: 2,
          page: 1,
        },
      },
    }
    const result = serializeResultJson(data)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual(data)
  })

  it('adds trailing newline', () => {
    const result = serializeResultJson({ ok: true })
    expect(result).toMatch(/\n$/)
  })

  it('formats with proper indentation', () => {
    const result = serializeResultJson({
      ok: true,
      nested: { value: 42 },
    })
    expect(result).toContain('  "ok": true')
    expect(result).toContain('    "value": 42')
  })

  it('handles objects with null values', () => {
    const result = serializeResultJson({
      ok: false,
      message: 'Error',
      data: null,
    })
    const parsed = JSON.parse(result)
    expect(parsed.data).toBeNull()
  })

  it('handles empty object', () => {
    const result = serializeResultJson({})
    expect(result).toBe('{}\n')
  })

  it('returns error JSON for null input', () => {
    const result = serializeResultJson(null as unknown as { ok: boolean })
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.message).toBe('Unable to serialize JSON')
    expect(process.exitCode).toBe(1)
  })

  it('returns error JSON for string input', () => {
    const result = serializeResultJson('not an object' as unknown as {
      ok: boolean
    })
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.cause).toContain('JSON was not an object')
    expect(process.exitCode).toBe(1)
  })

  it('returns error JSON for number input', () => {
    const result = serializeResultJson(42 as unknown as { ok: boolean })
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('returns error JSON for boolean input', () => {
    const result = serializeResultJson(true as unknown as { ok: boolean })
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('handles circular references gracefully', () => {
    const circular: Record<string, unknown> = { ok: true }
    circular.self = circular

    const result = serializeResultJson(circular as { ok: boolean })
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.message).toBe('Unable to serialize JSON')
    expect(process.exitCode).toBe(1)
  })

  it('handles arrays as valid input', () => {
    // Arrays are objects in JavaScript.
    const result = serializeResultJson([1, 2, 3] as unknown as { ok: boolean })
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toEqual([1, 2, 3])
  })
})
