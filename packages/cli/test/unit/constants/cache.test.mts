/**
 * Unit tests for cache constants.
 *
 * Purpose:
 * Tests the caching, TTL, and timeout constants.
 *
 * Test Coverage:
 * - Cache TTL constants
 * - Timeout constants
 *
 * Related Files:
 * - constants/cache.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  DLX_BINARY_CACHE_TTL,
  UPDATE_CHECK_TTL,
  UPDATE_NOTIFIER_TIMEOUT,
} from '../../../src/constants/cache.mts'

describe('cache constants', () => {
  describe('cache TTL constants', () => {
    it('has DLX_BINARY_CACHE_TTL constant (7 days)', () => {
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000
      expect(DLX_BINARY_CACHE_TTL).toBe(sevenDaysInMs)
    })

    it('has UPDATE_CHECK_TTL constant (24 hours)', () => {
      const oneDayInMs = 24 * 60 * 60 * 1000
      expect(UPDATE_CHECK_TTL).toBe(oneDayInMs)
    })
  })

  describe('timeout constants', () => {
    it('has UPDATE_NOTIFIER_TIMEOUT constant (10 seconds)', () => {
      const tenSecondsInMs = 10 * 1000
      expect(UPDATE_NOTIFIER_TIMEOUT).toBe(tenSecondsInMs)
    })
  })

  describe('constant value ranges', () => {
    it('DLX_BINARY_CACHE_TTL is greater than UPDATE_CHECK_TTL', () => {
      expect(DLX_BINARY_CACHE_TTL).toBeGreaterThan(UPDATE_CHECK_TTL)
    })

    it('UPDATE_CHECK_TTL is greater than UPDATE_NOTIFIER_TIMEOUT', () => {
      expect(UPDATE_CHECK_TTL).toBeGreaterThan(UPDATE_NOTIFIER_TIMEOUT)
    })

    it('all TTL values are positive', () => {
      expect(DLX_BINARY_CACHE_TTL).toBeGreaterThan(0)
      expect(UPDATE_CHECK_TTL).toBeGreaterThan(0)
      expect(UPDATE_NOTIFIER_TIMEOUT).toBeGreaterThan(0)
    })
  })
})
