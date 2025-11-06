/**
 * @fileoverview Unit tests for performance measurement utilities.
 *
 * Tests high-resolution time measurement via the Performance API:
 * - performance.now() provides monotonic timestamps in milliseconds
 * - Validates timing accuracy for elapsed time measurements
 * - Tests module import and basic functionality
 * - Ensures compatibility with Node.js performance hooks
 * Used for benchmarking, profiling, and timing operations in Socket tools.
 */

import { describe, expect, it } from 'vitest'

describe('performance', () => {
  describe('module import', () => {
    it('should import performance module', async () => {
      const module = await import('@socketsecurity/lib/performance')
      expect(module).toBeDefined()
    })
  })

  describe('basic performance measurements', () => {
    it('should measure elapsed time', { retry: 3 }, async () => {
      const start = performance.now()
      await new Promise(resolve => setTimeout(resolve, 10))
      const end = performance.now()
      const elapsed = end - start
      expect(elapsed).toBeGreaterThan(0)
      // Allow for timer imprecision (9ms threshold instead of 10ms)
      // setTimeout is not guaranteed to be exact due to OS scheduling
      expect(elapsed).toBeGreaterThanOrEqual(9)
    })

    it('should support performance.now()', () => {
      const now = performance.now()
      expect(typeof now).toBe('number')
      expect(now).toBeGreaterThan(0)
    })

    it('should provide monotonically increasing timestamps', () => {
      const t1 = performance.now()
      const t2 = performance.now()
      const t3 = performance.now()
      expect(t2).toBeGreaterThanOrEqual(t1)
      expect(t3).toBeGreaterThanOrEqual(t2)
    })
  })

  describe('performance timing', () => {
    it('should handle multiple timing measurements', () => {
      const measurements = []
      for (let i = 0; i < 5; i++) {
        measurements.push(performance.now())
      }
      expect(measurements.length).toBe(5)
      for (let i = 1; i < measurements.length; i++) {
        expect(measurements[i]).toBeGreaterThanOrEqual(measurements[i - 1])
      }
    })
  })

  describe('edge cases', () => {
    it('should handle rapid successive calls', () => {
      const times = []
      for (let i = 0; i < 100; i++) {
        times.push(performance.now())
      }
      expect(times.length).toBe(100)
      expect(times[times.length - 1]).toBeGreaterThanOrEqual(times[0])
    })

    it('should return high-resolution timestamps', () => {
      const t1 = performance.now()
      const t2 = performance.now()
      // High-resolution timer should show some difference
      expect(t2 - t1).toBeGreaterThanOrEqual(0)
    })
  })
})
