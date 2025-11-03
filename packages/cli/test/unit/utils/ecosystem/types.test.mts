import { describe, expect, it } from 'vitest'

import {
  ALL_ECOSYSTEMS,
  ALL_SUPPORTED_ECOSYSTEMS,
  getEcosystemChoicesForMeow,
  isValidEcosystem,
  parseEcosystems,
} from '../../../../src/src/utils/ecosystem/types.mts'

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

  describe('ALL_SUPPORTED_ECOSYSTEMS', () => {
    it('is a Set containing all ecosystems', () => {
      expect(ALL_SUPPORTED_ECOSYSTEMS).toBeInstanceOf(Set)
      expect(ALL_SUPPORTED_ECOSYSTEMS.size).toBe(ALL_ECOSYSTEMS.length)

      for (const ecosystem of ALL_ECOSYSTEMS) {
        expect(ALL_SUPPORTED_ECOSYSTEMS.has(ecosystem)).toBe(true)
      }
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

  describe('isValidEcosystem', () => {
    it('validates known ecosystems', () => {
      expect(isValidEcosystem('npm')).toBe(true)
      expect(isValidEcosystem('pypi')).toBe(true)
      expect(isValidEcosystem('cargo')).toBe(true)
      expect(isValidEcosystem('gem')).toBe(true)
      expect(isValidEcosystem('maven')).toBe(true)
    })

    it('rejects unknown ecosystems', () => {
      expect(isValidEcosystem('invalid')).toBe(false)
      expect(isValidEcosystem('NPM')).toBe(false) // Case-sensitive.
      expect(isValidEcosystem('')).toBe(false)
      expect(isValidEcosystem('node')).toBe(false)
    })

    it('validates all ecosystems in ALL_ECOSYSTEMS', () => {
      for (const ecosystem of ALL_ECOSYSTEMS) {
        expect(isValidEcosystem(ecosystem)).toBe(true)
      }
    })
  })

  describe('parseEcosystems', () => {
    it('parses comma-separated string', () => {
      const result = parseEcosystems('npm,pypi,cargo')
      expect(result).toEqual(['npm', 'pypi', 'cargo'])
    })

    it('trims whitespace from values', () => {
      const result = parseEcosystems('npm , pypi , cargo')
      expect(result).toEqual(['npm', 'pypi', 'cargo'])
    })

    it('converts to lowercase', () => {
      const result = parseEcosystems('NPM,PyPI,Cargo')
      expect(result).toEqual(['npm', 'pypi', 'cargo'])
    })

    it('filters out invalid ecosystems', () => {
      const result = parseEcosystems('npm,invalid,pypi,unknown-eco')
      expect(result).toEqual(['npm', 'pypi'])
    })

    it('handles array input', () => {
      const result = parseEcosystems(['npm', 'pypi', 'cargo'])
      expect(result).toEqual(['npm', 'pypi', 'cargo'])
    })

    it('handles array with invalid values', () => {
      const result = parseEcosystems(['npm', 'INVALID', 'PyPI'])
      expect(result).toEqual(['npm', 'pypi'])
    })

    it('returns empty array for undefined', () => {
      const result = parseEcosystems(undefined)
      expect(result).toEqual([])
    })

    it('returns empty array for empty string', () => {
      const result = parseEcosystems('')
      expect(result).toEqual([])
    })

    it('handles single ecosystem', () => {
      const result = parseEcosystems('npm')
      expect(result).toEqual(['npm'])
    })

    it('handles duplicates', () => {
      const result = parseEcosystems('npm,npm,pypi,pypi')
      expect(result).toEqual(['npm', 'npm', 'pypi', 'pypi'])
    })

    it('handles mixed valid and invalid with spaces', () => {
      const result = parseEcosystems('  npm  ,  invalid  ,  pypi  ')
      expect(result).toEqual(['npm', 'pypi'])
    })

    it('coerces non-string array elements', () => {
      const result = parseEcosystems([123, 'npm', true] as any)
      expect(result).toEqual(['npm'])
    })
  })
})
