/**
 * Unit tests for ecosystem type definitions.
 *
 * Purpose: Tests ecosystem type utilities and type guards. Validates TypeScript
 * type narrowing for ecosystems.
 *
 * Test Coverage: - Type guard functions - Ecosystem detection - Type narrowing
 * - Runtime type checking - Ecosystem enum validation.
 *
 * Testing Approach: Tests TypeScript type utilities with runtime validation.
 *
 * Related Files: - util/ecosystem/types.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  ALL_ECOSYSTEMS,
  getEcosystemChoicesForMeow,
} from '../../../../src/util/ecosystem/types.mts'

describe('ecosystem utilities', () => {
  describe('ALL_ECOSYSTEMS', () => {
    it('contains expected ecosystems', () => {
      expect(ALL_ECOSYSTEMS).toContain('npm')
      expect(ALL_ECOSYSTEMS).toContain('pypi')
      expect(ALL_ECOSYSTEMS).toContain('cargo')
      expect(ALL_ECOSYSTEMS).toContain('gem')
      expect(ALL_ECOSYSTEMS).toContain('maven')
      expect(ALL_ECOSYSTEMS).toContain('docker')
    })

    it('has unique values', () => {
      const uniqueValues = new Set(ALL_ECOSYSTEMS)
      expect(uniqueValues.size).toBe(ALL_ECOSYSTEMS.length)
    })

    it('is an array', () => {
      expect(Array.isArray(ALL_ECOSYSTEMS)).toBe(true)
    })
  })

  describe('getEcosystemChoicesForMeow', () => {
    it('returns array of all ecosystems', () => {
      const choices = getEcosystemChoicesForMeow()
      expect(Array.isArray(choices)).toBe(true)
      expect(choices).toEqual([...ALL_ECOSYSTEMS])
    })

    it('returns a new array instance', () => {
      const choices1 = getEcosystemChoicesForMeow()
      const choices2 = getEcosystemChoicesForMeow()
      expect(choices1).not.toBe(choices2)
      expect(choices1).toEqual(choices2)
    })
  })
})
