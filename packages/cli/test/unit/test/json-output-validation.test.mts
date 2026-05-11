/**
 * Unit tests for Socket JSON output validation helpers.
 *
 * Validates that command stdout matches the {ok:boolean, ...} CResult
 * contract documented in the source. Each error path emits a specific
 * message — these tests pin every one.
 *
 * Related Files:
 * - src/test/json-output-validation.mts
 */

import { describe, expect, it } from 'vitest'

import {
  isSocketJsonError,
  isSocketJsonSuccess,
  validateSocketJson,
} from '../../../src/test/json-output-validation.mts'

describe('validateSocketJson', () => {
  it('parses and returns a valid success response', () => {
    const result = validateSocketJson(
      JSON.stringify({ ok: true, data: { foo: 'bar' } }),
      0,
    )
    expect(result).toEqual({ ok: true, data: { foo: 'bar' } })
  })

  it('parses and returns a valid error response', () => {
    const result = validateSocketJson(
      JSON.stringify({ ok: false, message: 'failed', code: 1 }),
      1,
    )
    expect(result.ok).toBe(false)
  })

  it('throws on malformed JSON', () => {
    expect(() => validateSocketJson('{not json', 0)).toThrow(/not valid JSON/)
  })

  it('truncates long payloads in malformed-JSON errors', () => {
    const long = 'x'.repeat(500)
    expect(() => validateSocketJson(long, 0)).toThrow(/\.\.\./)
  })

  it('throws when ok field is missing', () => {
    expect(() => validateSocketJson(JSON.stringify({ data: 'x' }), 0)).toThrow(
      /missing boolean "ok"/,
    )
  })

  it('throws when ok field is not boolean', () => {
    expect(() =>
      validateSocketJson(JSON.stringify({ ok: 'yes', data: 'x' }), 0),
    ).toThrow(/missing boolean "ok"/)
  })

  it('throws when exit 0 but ok is false', () => {
    expect(() =>
      validateSocketJson(JSON.stringify({ ok: false, message: 'x' }), 0),
    ).toThrow(/exit code is 0 but "ok" is false/)
  })

  it('throws when ok:true but data is missing', () => {
    expect(() => validateSocketJson(JSON.stringify({ ok: true }), 0)).toThrow(
      /must include a non-null "data"/,
    )
  })

  it('throws when ok:true but data is null', () => {
    expect(() =>
      validateSocketJson(JSON.stringify({ ok: true, data: undefined }), 0),
    ).toThrow(/must include a non-null "data"/)
  })

  it('throws when exit non-zero but ok is true', () => {
    expect(() =>
      validateSocketJson(JSON.stringify({ ok: true, data: 'x' }), 1),
    ).toThrow(/exit code is 1 but "ok" is true/)
  })

  it('throws when ok:false but message is missing', () => {
    expect(() => validateSocketJson(JSON.stringify({ ok: false }), 1)).toThrow(
      /must include a non-empty "message"/,
    )
  })

  it('throws when ok:false but message is empty', () => {
    expect(() =>
      validateSocketJson(JSON.stringify({ ok: false, message: '' }), 1),
    ).toThrow(/must include a non-empty "message"/)
  })

  it('throws when error code is not a number', () => {
    expect(() =>
      validateSocketJson(
        JSON.stringify({ ok: false, message: 'x', code: 'not-a-number' }),
        1,
      ),
    ).toThrow(/"code" field must be a number/)
  })

  it('accepts a numeric error code', () => {
    const result = validateSocketJson(
      JSON.stringify({ ok: false, message: 'x', code: 42 }),
      1,
    )
    expect(result.ok).toBe(false)
  })

  it('accepts an error response without a code field', () => {
    const result = validateSocketJson(
      JSON.stringify({ ok: false, message: 'x' }),
      1,
    )
    expect(result.ok).toBe(false)
  })
})

describe('isSocketJsonSuccess', () => {
  it('returns true for success responses', () => {
    expect(isSocketJsonSuccess({ ok: true, data: 'x' })).toBe(true)
  })

  it('returns false for error responses', () => {
    expect(isSocketJsonSuccess({ ok: false, message: 'x' })).toBe(false)
  })
})

describe('isSocketJsonError', () => {
  it('returns true for error responses', () => {
    expect(isSocketJsonError({ ok: false, message: 'x' })).toBe(true)
  })

  it('returns false for success responses', () => {
    expect(isSocketJsonError({ ok: true, data: 'x' })).toBe(false)
  })
})
