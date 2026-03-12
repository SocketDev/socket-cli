/**
 * Unit tests for result validation utilities.
 *
 * Purpose:
 * Tests the CResult type helpers including validation, unwrapping, and mapping.
 *
 * Test Coverage:
 * - ResultError class
 * - requireOk function
 * - isOk and isError functions
 * - mapResult function
 * - chainResult function
 * - unwrapOr, unwrapOrNull, unwrapOrUndefined functions
 * - toResultPattern function
 *
 * Related Files:
 * - src/utils/data/result.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  ResultError,
  chainResult,
  isError,
  isOk,
  mapResult,
  requireOk,
  toResultPattern,
  unwrapOr,
  unwrapOrNull,
  unwrapOrUndefined,
} from '../../../../src/utils/data/result.mts'

import type { CResult } from '../../../../src/types.mts'

describe('result utilities', () => {
  describe('ResultError', () => {
    it('creates error with message', () => {
      const error = new ResultError('test error')

      expect(error.message).toBe('test error')
      expect(error.name).toBe('ResultError')
    })

    it('creates error with code option', () => {
      const error = new ResultError('test error', { code: 42 })

      expect(error.code).toBe(42)
    })

    it('creates error with cause option', () => {
      const error = new ResultError('test error', { cause: 'root cause' })

      expect(error.cause).toBe('root cause')
    })

    it('creates error with both code and cause', () => {
      const error = new ResultError('test error', {
        code: 127,
        cause: 'command not found',
      })

      expect(error.code).toBe(127)
      expect(error.cause).toBe('command not found')
    })

    it('handles undefined options', () => {
      const error = new ResultError('test error', undefined)

      expect(error.code).toBeUndefined()
      expect(error.cause).toBeUndefined()
    })

    it('handles empty options', () => {
      const error = new ResultError('test error', {})

      expect(error.code).toBeUndefined()
      expect(error.cause).toBeUndefined()
    })
  })

  describe('requireOk', () => {
    it('returns data for ok result', () => {
      const result: CResult<string> = { ok: true, data: 'test data' }

      const data = requireOk(result, 'test operation')

      expect(data).toBe('test data')
    })

    it('throws ResultError for error result', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      expect(() => requireOk(result, 'test operation')).toThrow(ResultError)
      expect(() => requireOk(result, 'test operation')).toThrow(
        'test operation: failed',
      )
    })

    it('includes code in thrown error', () => {
      const result: CResult<string> = { ok: false, message: 'failed', code: 42 }

      try {
        requireOk(result, 'test operation')
        expect.fail('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ResultError)
        expect((e as ResultError).code).toBe(42)
      }
    })

    it('includes cause in thrown error', () => {
      const result: CResult<string> = {
        ok: false,
        message: 'failed',
        cause: 'root cause',
      }

      try {
        requireOk(result, 'test operation')
        expect.fail('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ResultError)
        expect((e as ResultError).cause).toBe('root cause')
      }
    })
  })

  describe('isOk', () => {
    it('returns true for ok result', () => {
      const result: CResult<string> = { ok: true, data: 'test' }

      expect(isOk(result)).toBe(true)
    })

    it('returns false for error result', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      expect(isOk(result)).toBe(false)
    })
  })

  describe('isError', () => {
    it('returns false for ok result', () => {
      const result: CResult<string> = { ok: true, data: 'test' }

      expect(isError(result)).toBe(false)
    })

    it('returns true for error result', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      expect(isError(result)).toBe(true)
    })
  })

  describe('mapResult', () => {
    it('transforms data for ok result', () => {
      const result: CResult<number> = { ok: true, data: 5 }

      const mapped = mapResult(result, n => n * 2)

      expect(mapped.ok).toBe(true)
      expect(mapped.ok && mapped.data).toBe(10)
    })

    it('preserves message in mapped result', () => {
      const result: CResult<number> = {
        ok: true,
        data: 5,
        message: 'original message',
      }

      const mapped = mapResult(result, n => n.toString())

      expect(mapped.ok).toBe(true)
      expect(mapped.message).toBe('original message')
    })

    it('passes through error result unchanged', () => {
      const result: CResult<number> = {
        ok: false,
        message: 'failed',
        cause: 'reason',
        code: 42,
      }

      const mapped = mapResult(result, n => n * 2)

      expect(mapped).toBe(result)
      expect(mapped.ok).toBe(false)
    })
  })

  describe('chainResult', () => {
    it('chains operations for ok result', async () => {
      const result: CResult<number> = { ok: true, data: 5 }

      const chained = await chainResult(result, async n => ({
        ok: true as const,
        data: n * 2,
      }))

      expect(chained.ok).toBe(true)
      expect(chained.ok && chained.data).toBe(10)
    })

    it('passes through error without calling function', async () => {
      const result: CResult<number> = { ok: false, message: 'failed' }
      let called = false

      const chained = await chainResult(result, async n => {
        called = true
        return { ok: true as const, data: n * 2 }
      })

      expect(called).toBe(false)
      expect(chained).toBe(result)
    })

    it('returns error from chained function', async () => {
      const result: CResult<number> = { ok: true, data: 5 }

      const chained = await chainResult(result, async () => ({
        ok: false as const,
        message: 'chained failed',
      }))

      expect(chained.ok).toBe(false)
      expect(!chained.ok && chained.message).toBe('chained failed')
    })
  })

  describe('unwrapOr', () => {
    it('returns data for ok result', () => {
      const result: CResult<string> = { ok: true, data: 'success' }

      expect(unwrapOr(result, 'default')).toBe('success')
    })

    it('returns default for error result', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      expect(unwrapOr(result, 'default')).toBe('default')
    })
  })

  describe('unwrapOrNull', () => {
    it('returns data for ok result', () => {
      const result: CResult<string> = { ok: true, data: 'success' }

      expect(unwrapOrNull(result)).toBe('success')
    })

    it('returns null for error result', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      expect(unwrapOrNull(result)).toBeNull()
    })
  })

  describe('unwrapOrUndefined', () => {
    it('returns data for ok result', () => {
      const result: CResult<string> = { ok: true, data: 'success' }

      expect(unwrapOrUndefined(result)).toBe('success')
    })

    it('returns undefined for error result', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      expect(unwrapOrUndefined(result)).toBeUndefined()
    })
  })

  describe('toResultPattern', () => {
    it('converts ok result to standard pattern', () => {
      const result: CResult<string> = { ok: true, data: 'test' }

      const pattern = toResultPattern(result)

      expect(pattern.ok).toBe(true)
      expect(pattern.ok && pattern.data).toBe('test')
    })

    it('converts error result to standard pattern with Error', () => {
      const result: CResult<string> = { ok: false, message: 'failed' }

      const pattern = toResultPattern(result)

      expect(pattern.ok).toBe(false)
      expect(!pattern.ok && pattern.error).toBeInstanceOf(Error)
      expect(!pattern.ok && pattern.error.message).toBe('failed')
    })

    it('includes cause in Error when present', () => {
      const result: CResult<string> = {
        ok: false,
        message: 'failed',
        cause: 'root cause',
      }

      const pattern = toResultPattern(result)

      expect(!pattern.ok && pattern.error.cause).toBe('root cause')
    })
  })
})
