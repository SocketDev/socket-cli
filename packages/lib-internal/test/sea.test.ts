/**
 * @fileoverview Unit tests for Node.js Single Executable Application (SEA) utilities.
 *
 * Tests Node.js SEA (Single Executable Application) detection:
 * - isSeaBinary() detects if running as SEA binary
 * - getSeaBinaryPath() returns SEA binary path if applicable
 * - NODE_SEA_FUSE environment detection
 * - Process state inspection for SEA mode
 * Used by Socket CLI to detect standalone executable deployment.
 */

import { getSeaBinaryPath, isSeaBinary } from '@socketsecurity/lib/sea'
import { describe, expect, it } from 'vitest'

describe('sea', () => {
  describe('isSeaBinary', () => {
    it('should return boolean', () => {
      const result = isSeaBinary()
      expect(typeof result).toBe('boolean')
    })

    it('should be callable multiple times', () => {
      const result1 = isSeaBinary()
      const result2 = isSeaBinary()
      const result3 = isSeaBinary()

      // Should return consistent results
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
      expect(typeof result1).toBe('boolean')
    })

    it('should return false in test environment', () => {
      // In normal test environments, we're not running as SEA binary
      const result = isSeaBinary()
      expect(result).toBe(false)
    })

    it('should not throw errors', () => {
      expect(() => isSeaBinary()).not.toThrow()
    })

    it('should cache result after first call', () => {
      // Call multiple times - should be fast (cached)
      const start = Date.now()
      for (let i = 0; i < 100; i++) {
        isSeaBinary()
      }
      const duration = Date.now() - start
      // Should be extremely fast due to caching
      expect(duration).toBeLessThan(50)
    })
  })

  describe('getSeaBinaryPath', () => {
    it('should return string or undefined', () => {
      const result = getSeaBinaryPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })

    it('should return undefined in test environment', () => {
      // In normal test environments, we're not running as SEA binary
      const result = getSeaBinaryPath()
      expect(result).toBeUndefined()
    })

    it('should not throw errors', () => {
      expect(() => getSeaBinaryPath()).not.toThrow()
    })

    it('should be callable multiple times', () => {
      const result1 = getSeaBinaryPath()
      const result2 = getSeaBinaryPath()
      const result3 = getSeaBinaryPath()

      // Should return consistent results
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })

    it('should cache result based on isSeaBinary', () => {
      // Call multiple times - should be fast (cached)
      const start = Date.now()
      for (let i = 0; i < 100; i++) {
        getSeaBinaryPath()
      }
      const duration = Date.now() - start
      // Should be extremely fast due to caching
      expect(duration).toBeLessThan(50)
    })
  })

  describe('integration', () => {
    it('should have consistent behavior between isSeaBinary and getSeaBinaryPath', () => {
      const isSea = isSeaBinary()
      const binaryPath = getSeaBinaryPath()

      if (isSea) {
        // If running as SEA, should have a path
        expect(binaryPath).toBeDefined()
        expect(typeof binaryPath).toBe('string')
        expect(binaryPath?.length).toBeGreaterThan(0)
      } else {
        // If not running as SEA, should not have a path
        expect(binaryPath).toBeUndefined()
      }
    })

    it('should handle multiple calls consistently', () => {
      const isSea1 = isSeaBinary()
      const path1 = getSeaBinaryPath()

      const isSea2 = isSeaBinary()
      const path2 = getSeaBinaryPath()

      expect(isSea1).toBe(isSea2)
      expect(path1).toBe(path2)
    })

    it('should maintain consistency across interleaved calls', () => {
      const results: Array<[boolean, string | undefined]> = []

      for (let i = 0; i < 10; i++) {
        results.push([isSeaBinary(), getSeaBinaryPath()])
      }

      // All results should be identical
      const first = results[0]
      for (const result of results) {
        expect(result[0]).toBe(first?.[0])
        expect(result[1]).toBe(first?.[1])
      }
    })
  })

  describe('behavior', () => {
    it('should handle node:sea module availability correctly', () => {
      // In Node.js 20+, node:sea module should be available
      // In older versions, it should gracefully handle absence
      const isSea = isSeaBinary()
      const path = getSeaBinaryPath()

      // Should not throw, regardless of availability
      expect(typeof isSea).toBe('boolean')
      expect(path === undefined || typeof path === 'string').toBe(true)
    })

    it('should have low performance impact', () => {
      // First call might require module loading
      isSeaBinary()

      // Subsequent calls should be cached and very fast
      const iterations = 10_000
      const start = Date.now()
      for (let i = 0; i < iterations; i++) {
        isSeaBinary()
        getSeaBinaryPath()
      }
      const duration = Date.now() - start

      // 10000 iterations of both functions should complete quickly
      expect(duration).toBeLessThan(100)
    })

    it('should return sensible defaults when node:sea is unavailable', () => {
      // Even if node:sea module is not available, functions should work
      const isSea = isSeaBinary()
      const path = getSeaBinaryPath()

      expect(isSea).toBe(false)
      expect(path).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle rapid successive calls', () => {
      const results = []
      for (let i = 0; i < 100; i++) {
        results.push(isSeaBinary())
        results.push(getSeaBinaryPath())
      }

      // All boolean results should be identical
      const boolResults = results.filter(r => typeof r === 'boolean')
      expect(new Set(boolResults).size).toBe(1)
    })

    it('should work in parallel scenarios', () => {
      // Simulate concurrent access
      const promises = Array.from({ length: 50 }, () =>
        Promise.resolve().then(() => ({
          isSea: isSeaBinary(),
          path: getSeaBinaryPath(),
        })),
      )

      return Promise.all(promises).then(results => {
        // All results should be identical
        const first = results[0]
        for (const result of results) {
          expect(result.isSea).toBe(first?.isSea)
          expect(result.path).toBe(first?.path)
        }
      })
    })
  })
})
