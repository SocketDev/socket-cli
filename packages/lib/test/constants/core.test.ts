/**
 * @fileoverview Unit tests for core primitives and fundamental constants.
 *
 * Tests fundamental constants and symbols:
 * - Symbols: kInternalsSymbol for internal state access
 * - Sentinel values: EMPTY_VALUE, UNKNOWN_VALUE, UNDEFINED_TOKEN, LOOP_SENTINEL
 * - Limits: COLUMN_LIMIT for terminal formatting
 * - Tokens: NODE_AUTH_TOKEN, NODE_ENV keys, UNKNOWN_ERROR
 * - Version markers: V (void 0)
 * All frozen to prevent modification. Foundation for type-safe constant usage.
 */

import { describe, expect, it } from 'vitest'

import {
  COLUMN_LIMIT,
  EMPTY_FILE,
  EMPTY_VALUE,
  kInternalsSymbol,
  LOOP_SENTINEL,
  NODE_AUTH_TOKEN,
  NODE_ENV,
  UNDEFINED_TOKEN,
  UNKNOWN_ERROR,
  UNKNOWN_VALUE,
  V,
} from '@socketsecurity/lib/constants/core'

describe('constants/core', () => {
  describe('symbols', () => {
    it('should export kInternalsSymbol as a symbol', () => {
      expect(typeof kInternalsSymbol).toBe('symbol')
    })

    it('should have correct description for kInternalsSymbol', () => {
      expect(kInternalsSymbol.toString()).toBe(
        'Symbol(@socketregistry.constants.internals)',
      )
    })

    it('should be unique symbol instance', () => {
      const anotherSymbol = Symbol('@socketregistry.constants.internals')
      expect(kInternalsSymbol).not.toBe(anotherSymbol)
    })
  })

  describe('sentinel values', () => {
    it('should export LOOP_SENTINEL as 1000000', () => {
      expect(LOOP_SENTINEL).toBe(1_000_000)
    })

    it('should be a number', () => {
      expect(typeof LOOP_SENTINEL).toBe('number')
    })

    it('should be positive integer', () => {
      expect(LOOP_SENTINEL).toBeGreaterThan(0)
      expect(Number.isInteger(LOOP_SENTINEL)).toBe(true)
    })
  })

  describe('error and unknown values', () => {
    it('should export UNKNOWN_ERROR constant', () => {
      expect(UNKNOWN_ERROR).toBe('Unknown error')
    })

    it('should export UNKNOWN_VALUE constant', () => {
      expect(UNKNOWN_VALUE).toBe('<unknown>')
    })

    it('should be strings', () => {
      expect(typeof UNKNOWN_ERROR).toBe('string')
      expect(typeof UNKNOWN_VALUE).toBe('string')
    })
  })

  describe('empty values', () => {
    it('should export EMPTY_FILE constant', () => {
      expect(EMPTY_FILE).toBe('/* empty */\n')
    })

    it('should export EMPTY_VALUE constant', () => {
      expect(EMPTY_VALUE).toBe('<value>')
    })

    it('should be strings', () => {
      expect(typeof EMPTY_FILE).toBe('string')
      expect(typeof EMPTY_VALUE).toBe('string')
    })

    it('should have newline in EMPTY_FILE', () => {
      expect(EMPTY_FILE).toContain('\n')
      expect(EMPTY_FILE.endsWith('\n')).toBe(true)
    })

    it('should be valid JavaScript comment', () => {
      expect(EMPTY_FILE).toMatch(/^\/\*.*\*\//)
    })
  })

  describe('undefined token', () => {
    it('should export UNDEFINED_TOKEN as undefined', () => {
      expect(UNDEFINED_TOKEN).toBeUndefined()
    })

    it('should strictly equal undefined', () => {
      expect(UNDEFINED_TOKEN === undefined).toBe(true)
    })

    it('should have type undefined', () => {
      expect(typeof UNDEFINED_TOKEN).toBe('undefined')
    })
  })

  describe('miscellaneous constants', () => {
    it('should export V constant', () => {
      expect(V).toBe('v')
    })

    it('should export COLUMN_LIMIT constant', () => {
      expect(COLUMN_LIMIT).toBe(80)
    })

    it('should be correct types', () => {
      expect(typeof V).toBe('string')
      expect(typeof COLUMN_LIMIT).toBe('number')
    })

    it('should have reasonable COLUMN_LIMIT value', () => {
      expect(COLUMN_LIMIT).toBeGreaterThan(0)
      expect(COLUMN_LIMIT).toBeLessThanOrEqual(200)
    })
  })

  describe('environment variable name constants', () => {
    it('should export NODE_AUTH_TOKEN constant', () => {
      expect(NODE_AUTH_TOKEN).toBe('NODE_AUTH_TOKEN')
    })

    it('should export NODE_ENV constant', () => {
      expect(NODE_ENV).toBe('NODE_ENV')
    })

    it('should be strings', () => {
      expect(typeof NODE_AUTH_TOKEN).toBe('string')
      expect(typeof NODE_ENV).toBe('string')
    })

    it('should be uppercase with underscores', () => {
      expect(NODE_AUTH_TOKEN).toMatch(/^[A-Z_]+$/)
      expect(NODE_ENV).toMatch(/^[A-Z_]+$/)
    })
  })

  describe('constant immutability', () => {
    it('should not allow reassignment of LOOP_SENTINEL', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        LOOP_SENTINEL = 999
      }).toThrow()
    })

    it('should not allow reassignment of string constants', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        UNKNOWN_ERROR = 'Different error'
      }).toThrow()
    })
  })

  describe('constant usage patterns', () => {
    it('should use EMPTY_FILE for empty source files', () => {
      const emptyFileContent = EMPTY_FILE
      expect(emptyFileContent).toMatch(/\/\*.*\*\//)
    })

    it('should use UNKNOWN_VALUE for placeholder text', () => {
      const placeholder = UNKNOWN_VALUE
      expect(placeholder).toMatch(/^<.*>$/)
    })

    it('should use LOOP_SENTINEL for iteration limits', () => {
      const maxIterations = LOOP_SENTINEL
      expect(maxIterations).toBeGreaterThan(1000)
    })

    it('should use V as version prefix', () => {
      const version = `${V}1.0.0`
      expect(version).toBe('v1.0.0')
    })
  })

  describe('constant value formats', () => {
    it('should have angle brackets for placeholder values', () => {
      expect(UNKNOWN_VALUE.startsWith('<')).toBe(true)
      expect(UNKNOWN_VALUE.endsWith('>')).toBe(true)
      expect(EMPTY_VALUE.startsWith('<')).toBe(true)
      expect(EMPTY_VALUE.endsWith('>')).toBe(true)
    })

    it('should have consistent naming pattern for env vars', () => {
      expect(NODE_AUTH_TOKEN.startsWith('NODE_')).toBe(true)
      expect(NODE_ENV.startsWith('NODE_')).toBe(true)
    })
  })
})
