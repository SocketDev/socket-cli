/**
 * Unit tests for SEA detection utilities.
 *
 * Purpose:
 * Tests the SEA (Single Executable Application) detection and related utilities.
 *
 * Test Coverage:
 * - isSeaBinary function
 * - getSeaBinaryPath function
 * - canSelfUpdate function
 *
 * Note: These tests verify behavior in a non-SEA environment since the tests
 * run in Node.js where node:sea module is not available. SEA-specific behavior
 * is tested by verifying the API surface and return types.
 *
 * Related Files:
 * - src/utils/sea/detect.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  canSelfUpdate,
  getSeaBinaryPath,
  isSeaBinary,
} from '../../../../src/utils/sea/detect.mts'

describe('SEA detection utilities', () => {
  describe('isSeaBinary', () => {
    it('returns false in non-SEA environment', () => {
      // In a test environment running via Node.js (not SEA), this should return false.
      expect(isSeaBinary()).toBe(false)
    })

    it('returns consistent results on multiple calls', () => {
      // The result should be cached and consistent.
      const result1 = isSeaBinary()
      const result2 = isSeaBinary()
      const result3 = isSeaBinary()

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })

    it('returns a boolean', () => {
      expect(typeof isSeaBinary()).toBe('boolean')
    })
  })

  describe('getSeaBinaryPath', () => {
    it('returns undefined in non-SEA environment', () => {
      // Since we're not running as SEA, this should return undefined.
      expect(getSeaBinaryPath()).toBeUndefined()
    })

    it('returns undefined or string type', () => {
      const result = getSeaBinaryPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })
  })

  describe('canSelfUpdate', () => {
    it('returns false in non-SEA environment', () => {
      // Self-update requires SEA binary, so false in test environment.
      expect(canSelfUpdate()).toBe(false)
    })

    it('returns a boolean', () => {
      expect(typeof canSelfUpdate()).toBe('boolean')
    })
  })

  describe('function exports', () => {
    it('exports isSeaBinary function', () => {
      expect(typeof isSeaBinary).toBe('function')
    })

    it('exports getSeaBinaryPath function', () => {
      expect(typeof getSeaBinaryPath).toBe('function')
    })

    it('exports canSelfUpdate function', () => {
      expect(typeof canSelfUpdate).toBe('function')
    })
  })
})
