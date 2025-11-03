import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { msAtHome } from '../../../src/src/utils/home-cache-time.mts'

describe('ms-at-home utilities', () => {
  let originalNow: () => number
  let mockNow: number

  beforeEach(() => {
    // Mock Date.now() for consistent testing.
    originalNow = Date.now
    mockNow = new Date('2024-01-15T12:00:00Z').getTime()
    Date.now = vi.fn(() => mockNow)
  })

  afterEach(() => {
    // Restore original Date.now.
    Date.now = originalNow
  })

  describe('msAtHome', () => {
    it('returns minutes ago for times less than 1 hour ago', () => {
      // 30 minutes ago.
      const timestamp = new Date('2024-01-15T11:30:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('30 min. ago')
    })

    it('returns minutes ago for times just under 1 hour', () => {
      // 59 minutes ago.
      const timestamp = new Date('2024-01-15T11:01:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('59 min. ago')
    })

    it('returns hours ago for times between 1 and 24 hours ago', () => {
      // 2.5 hours ago.
      const timestamp = new Date('2024-01-15T09:30:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('2.5 hr. ago')
    })

    it('returns hours ago for times just under 24 hours', () => {
      // 23.5 hours ago.
      const timestamp = new Date('2024-01-14T12:30:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('23.5 hr. ago')
    })

    it('returns days ago for times between 1 and 7 days ago', () => {
      // 3.5 days ago.
      const timestamp = new Date('2024-01-12T00:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('3.5 days ago')
    })

    it('returns days ago for times just under 7 days', () => {
      // 6.5 days ago.
      const timestamp = new Date('2024-01-09T00:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('6.5 days ago')
    })

    it('returns date string for times 7 or more days ago', () => {
      // 8 days ago.
      const timestamp = new Date('2024-01-07T12:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('2024-01-07')
    })

    it('returns date string for times months ago', () => {
      // 2 months ago.
      const timestamp = new Date('2023-11-15T12:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('2023-11-15')
    })

    it('returns date string for times years ago', () => {
      // 1 year ago.
      const timestamp = new Date('2023-01-15T12:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('2023-01-15')
    })

    it('handles current time (0 minutes ago)', () => {
      const timestamp = new Date('2024-01-15T12:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('0 min. ago')
    })

    it('handles 1 minute ago', () => {
      const timestamp = new Date('2024-01-15T11:59:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('1 min. ago')
    })

    it('handles exactly 1 hour ago', () => {
      const timestamp = new Date('2024-01-15T11:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('1 hr. ago')
    })

    it('handles exactly 24 hours ago', () => {
      const timestamp = new Date('2024-01-14T12:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('1 day ago')
    })

    it('handles exactly 7 days ago', () => {
      const timestamp = new Date('2024-01-08T12:00:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toBe('2024-01-08')
    })

    it('formats relative time with correct units', () => {
      // Test that Intl.RelativeTimeFormat is being used properly.
      // 45 minutes ago.
      const timestamp = new Date('2024-01-15T11:15:00Z').toISOString()
      const result = msAtHome(timestamp)
      expect(result).toMatch(/45 min/)
    })

    it('handles invalid date strings gracefully', () => {
      // Invalid dates will cause Date.parse to return NaN.
      const timestamp = 'not-a-valid-date'
      const result = msAtHome(timestamp)
      // NaN - NaN = NaN, and NaN comparisons are always false,
      // so it will fall through to the else branch and return first 10 chars.
      expect(result).toBe('not-a-vali')
    })

    it('preserves ISO date format in output for old dates', () => {
      // 1 month ago with specific time.
      const timestamp = '2023-12-15T08:30:45.123Z'
      const result = msAtHome(timestamp)
      expect(result).toBe('2023-12-15')
    })
  })
})
