import { describe, expect, it } from 'vitest'

import { serializeResultJson } from './result-json.mts'

describe('serializeResultJson', () => {
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
})
