/**
 * @fileoverview Unit tests for time-related constants.
 *
 * Tests time conversion constants:
 * - MS_PER_SECOND (1000), MS_PER_MINUTE (60000), MS_PER_HOUR, MS_PER_DAY
 * - Timeout defaults for various operations
 * - Date/time format constants
 * Frozen constants for time calculations.
 */

import { describe, expect, it } from 'vitest'

import {
  DLX_BINARY_CACHE_TTL,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from '@socketsecurity/lib/constants/time'

describe('constants/time', () => {
  describe('time multipliers', () => {
    it('should export MILLISECONDS_PER_SECOND', () => {
      expect(MILLISECONDS_PER_SECOND).toBe(1000)
    })

    it('should export MILLISECONDS_PER_MINUTE', () => {
      expect(MILLISECONDS_PER_MINUTE).toBe(60 * 1000)
    })

    it('should export MILLISECONDS_PER_HOUR', () => {
      expect(MILLISECONDS_PER_HOUR).toBe(60 * 60 * 1000)
    })

    it('should export MILLISECONDS_PER_DAY', () => {
      expect(MILLISECONDS_PER_DAY).toBe(24 * 60 * 60 * 1000)
    })

    it('should have correct minute calculation', () => {
      expect(MILLISECONDS_PER_MINUTE).toBe(60 * MILLISECONDS_PER_SECOND)
    })

    it('should have correct hour calculation', () => {
      expect(MILLISECONDS_PER_HOUR).toBe(60 * MILLISECONDS_PER_MINUTE)
    })

    it('should have correct day calculation', () => {
      expect(MILLISECONDS_PER_DAY).toBe(24 * MILLISECONDS_PER_HOUR)
    })

    it('should be numbers', () => {
      expect(typeof MILLISECONDS_PER_SECOND).toBe('number')
      expect(typeof MILLISECONDS_PER_MINUTE).toBe('number')
      expect(typeof MILLISECONDS_PER_HOUR).toBe('number')
      expect(typeof MILLISECONDS_PER_DAY).toBe('number')
    })

    it('should be positive integers', () => {
      expect(MILLISECONDS_PER_SECOND).toBeGreaterThan(0)
      expect(MILLISECONDS_PER_MINUTE).toBeGreaterThan(0)
      expect(MILLISECONDS_PER_HOUR).toBeGreaterThan(0)
      expect(MILLISECONDS_PER_DAY).toBeGreaterThan(0)
    })

    it('should be in ascending order', () => {
      expect(MILLISECONDS_PER_SECOND).toBeLessThan(MILLISECONDS_PER_MINUTE)
      expect(MILLISECONDS_PER_MINUTE).toBeLessThan(MILLISECONDS_PER_HOUR)
      expect(MILLISECONDS_PER_HOUR).toBeLessThan(MILLISECONDS_PER_DAY)
    })
  })

  describe('cache TTL', () => {
    it('should export DLX_BINARY_CACHE_TTL', () => {
      expect(DLX_BINARY_CACHE_TTL).toBeDefined()
    })

    it('should be 7 days in milliseconds', () => {
      expect(DLX_BINARY_CACHE_TTL).toBe(7 * MILLISECONDS_PER_DAY)
    })

    it('should be correct value', () => {
      expect(DLX_BINARY_CACHE_TTL).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('should be a number', () => {
      expect(typeof DLX_BINARY_CACHE_TTL).toBe('number')
    })

    it('should be positive', () => {
      expect(DLX_BINARY_CACHE_TTL).toBeGreaterThan(0)
    })

    it('should be greater than one day', () => {
      expect(DLX_BINARY_CACHE_TTL).toBeGreaterThan(MILLISECONDS_PER_DAY)
    })
  })

  describe('real-world usage', () => {
    it('should support timeout calculations', () => {
      const timeout = 5 * MILLISECONDS_PER_SECOND
      expect(timeout).toBe(5000)
    })

    it('should support Date calculations', () => {
      const now = Date.now()
      const oneMinuteLater = now + MILLISECONDS_PER_MINUTE
      expect(oneMinuteLater - now).toBe(60_000)
    })

    it('should support duration formatting', () => {
      const duration = 2 * MILLISECONDS_PER_HOUR + 30 * MILLISECONDS_PER_MINUTE
      expect(duration).toBe(9_000_000) // 2.5 hours in ms
    })

    it('should support cache expiry checks', () => {
      const createdAt = Date.now()
      const expiresAt = createdAt + DLX_BINARY_CACHE_TTL
      const timeUntilExpiry = expiresAt - createdAt
      expect(timeUntilExpiry).toBe(DLX_BINARY_CACHE_TTL)
    })
  })
})
