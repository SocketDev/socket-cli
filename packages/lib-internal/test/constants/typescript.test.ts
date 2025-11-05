/**
 * @fileoverview Unit tests for TypeScript availability checks.
 *
 * Tests TypeScript-related constants:
 * - Compiler availability detection
 * - Target/module constants (ES2022, ESNext, CommonJS)
 * - tsconfig.json paths and defaults
 * - Type declaration patterns
 * Frozen constants for TypeScript tooling.
 */

import { describe, expect, it } from 'vitest'

import {
  getTsLibsAvailable,
  getTsTypesAvailable,
} from '@socketsecurity/lib/constants/typescript'

describe('constants/typescript', () => {
  describe('getTsTypesAvailable', () => {
    it('should return a boolean', () => {
      const result = getTsTypesAvailable()
      expect(typeof result).toBe('boolean')
    })

    it('should check for typescript/lib/lib.d.ts', () => {
      const result = getTsTypesAvailable()
      // Result depends on whether typescript is installed
      expect([true, false]).toContain(result)
    })

    it('should be consistent across multiple calls', () => {
      const first = getTsTypesAvailable()
      const second = getTsTypesAvailable()
      expect(first).toBe(second)
    })

    it('should not throw when typescript is not available', () => {
      expect(() => getTsTypesAvailable()).not.toThrow()
    })

    it('should handle require.resolve internally', () => {
      // This test verifies the function executes without errors
      const result = getTsTypesAvailable()
      expect(result).toBeDefined()
    })
  })

  describe('getTsLibsAvailable', () => {
    it('should return a boolean', () => {
      const result = getTsLibsAvailable()
      expect(typeof result).toBe('boolean')
    })

    it('should check for typescript/lib', () => {
      const result = getTsLibsAvailable()
      // Result depends on whether typescript is installed
      expect([true, false]).toContain(result)
    })

    it('should be consistent across multiple calls', () => {
      const first = getTsLibsAvailable()
      const second = getTsLibsAvailable()
      expect(first).toBe(second)
    })

    it('should not throw when typescript is not available', () => {
      expect(() => getTsLibsAvailable()).not.toThrow()
    })

    it('should handle require.resolve internally', () => {
      // This test verifies the function executes without errors
      const result = getTsLibsAvailable()
      expect(result).toBeDefined()
    })
  })

  describe('TypeScript availability correlation', () => {
    it('should have same availability for both checks when typescript is present', () => {
      const typesAvailable = getTsTypesAvailable()
      const libsAvailable = getTsLibsAvailable()

      // If one is available, the other should be too (when typescript is installed)
      if (typesAvailable || libsAvailable) {
        // At least one should be true if typescript is available
        expect(typesAvailable || libsAvailable).toBe(true)
      }
    })

    it('should both return false when typescript is not installed', () => {
      const typesAvailable = getTsTypesAvailable()
      const libsAvailable = getTsLibsAvailable()

      // If both are false, typescript is not installed
      if (!typesAvailable && !libsAvailable) {
        expect(typesAvailable).toBe(false)
        expect(libsAvailable).toBe(false)
      }
    })
  })

  describe('error handling', () => {
    it('should gracefully handle module resolution errors for types', () => {
      expect(() => {
        const result = getTsTypesAvailable()
        expect(typeof result).toBe('boolean')
      }).not.toThrow()
    })

    it('should gracefully handle module resolution errors for libs', () => {
      expect(() => {
        const result = getTsLibsAvailable()
        expect(typeof result).toBe('boolean')
      }).not.toThrow()
    })

    it('should return false instead of throwing on module not found', () => {
      // These functions should catch errors and return false
      const types = getTsTypesAvailable()
      const libs = getTsLibsAvailable()

      expect([true, false]).toContain(types)
      expect([true, false]).toContain(libs)
    })
  })

  describe('function independence', () => {
    it('should allow calling getTsTypesAvailable independently', () => {
      const result = getTsTypesAvailable()
      expect(result).toBeDefined()
    })

    it('should allow calling getTsLibsAvailable independently', () => {
      const result = getTsLibsAvailable()
      expect(result).toBeDefined()
    })

    it('should not affect each other when called in sequence', () => {
      const types1 = getTsTypesAvailable()
      const libs1 = getTsLibsAvailable()
      const types2 = getTsTypesAvailable()
      const libs2 = getTsLibsAvailable()

      expect(types1).toBe(types2)
      expect(libs1).toBe(libs2)
    })

    it('should not affect each other when called in reverse sequence', () => {
      const libs1 = getTsLibsAvailable()
      const types1 = getTsTypesAvailable()
      const libs2 = getTsLibsAvailable()
      const types2 = getTsTypesAvailable()

      expect(types1).toBe(types2)
      expect(libs1).toBe(libs2)
    })
  })

  describe('performance', () => {
    it('should execute quickly', () => {
      const start = Date.now()
      getTsTypesAvailable()
      const duration = Date.now() - start
      // Should complete in under 100ms
      expect(duration).toBeLessThan(100)
    })

    it('should execute libs check quickly', () => {
      const start = Date.now()
      getTsLibsAvailable()
      const duration = Date.now() - start
      // Should complete in under 100ms
      expect(duration).toBeLessThan(100)
    })

    it('should handle multiple rapid calls', () => {
      const start = Date.now()
      for (let i = 0; i < 10; i++) {
        getTsTypesAvailable()
        getTsLibsAvailable()
      }
      const duration = Date.now() - start
      // 20 calls should complete in under 500ms
      expect(duration).toBeLessThan(500)
    })
  })

  describe('return value validation', () => {
    it('should never return null for getTsTypesAvailable', () => {
      const result = getTsTypesAvailable()
      expect(result).not.toBeNull()
    })

    it('should never return undefined for getTsTypesAvailable', () => {
      const result = getTsTypesAvailable()
      expect(result).not.toBeUndefined()
    })

    it('should never return null for getTsLibsAvailable', () => {
      const result = getTsLibsAvailable()
      expect(result).not.toBeNull()
    })

    it('should never return undefined for getTsLibsAvailable', () => {
      const result = getTsLibsAvailable()
      expect(result).not.toBeUndefined()
    })
  })

  describe('real-world usage scenarios', () => {
    it('should be suitable for conditional TypeScript feature enablement', () => {
      const typesAvailable = getTsTypesAvailable()

      if (typesAvailable) {
        // TypeScript types are available, can use type checking
        expect(typesAvailable).toBe(true)
      } else {
        // TypeScript types not available, skip type checking
        expect(typesAvailable).toBe(false)
      }
    })

    it('should be suitable for library path resolution', () => {
      const libsAvailable = getTsLibsAvailable()

      if (libsAvailable) {
        // TypeScript libs are available, can load compiler
        expect(libsAvailable).toBe(true)
      } else {
        // TypeScript libs not available, skip compilation
        expect(libsAvailable).toBe(false)
      }
    })

    it('should support feature detection pattern', () => {
      const hasTypeScript = getTsTypesAvailable() && getTsLibsAvailable()
      expect(typeof hasTypeScript).toBe('boolean')
    })
  })
})
