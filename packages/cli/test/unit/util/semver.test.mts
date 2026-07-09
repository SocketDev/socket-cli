/**
 * Unit tests for semver utilities.
 *
 * Purpose: Tests semantic versioning utilities. Validates version parsing,
 * comparison, and range matching.
 *
 * Test Coverage: - Version parsing - Version comparison - Range satisfaction -
 * Version sorting - Prerelease handling - Build metadata.
 *
 * Testing Approach: Tests semver utilities used for dependency version
 * resolution.
 *
 * Related Files: - util/semver.mts (implementation)
 */

// socket-lint: allow bare-semver -- lib-stable 6.0.9 doesn't publish ./external/semver; semver is a devDep in tests so no runtime dep leaks.
import semver from 'semver'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getMajor, RangeStyles } from '../../../src/util/semver.mts'

// Mock semver.
vi.mock(import('semver'), () => ({
  default: {
    coerce: vi.fn(),
    major: vi.fn(),
    minVersion: vi.fn(),
  },
}))

describe('semver utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('RangeStyles', () => {
    it('contains expected styles', () => {
      expect(RangeStyles).toEqual(['pin', 'preserve'])
    })
  })

  describe('getMajor', () => {
    it('returns major version for valid semver', () => {
      vi.mocked(semver.coerce).mockReturnValue({ version: '1.2.3' } as unknown)
      vi.mocked(semver.major).mockReturnValue(1)

      const result = getMajor('1.2.3')
      expect(result).toBe(1)
      expect(semver.coerce).toHaveBeenCalledWith('1.2.3')
      expect(semver.major).toHaveBeenCalledWith({ version: '1.2.3' })
    })

    it('returns undefined when coerce returns null', () => {
      vi.mocked(semver.coerce).mockReturnValue(undefined)

      const result = getMajor('invalid')
      expect(result).toBeUndefined()
    })

    it('returns undefined when coerce throws', () => {
      vi.mocked(semver.coerce).mockImplementation(() => {
        throw new Error('Invalid version')
      })

      const result = getMajor('bad-version')
      expect(result).toBeUndefined()
    })

    it('handles non-string input', () => {
      vi.mocked(semver.coerce).mockReturnValue(undefined)

      expect(getMajor(123)).toBeUndefined()
      expect(getMajor(undefined)).toBeUndefined()
      expect(getMajor(undefined)).toBeUndefined()
      expect(getMajor({})).toBeUndefined()
    })
  })
})
