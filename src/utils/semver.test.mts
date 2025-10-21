import semver from 'semver'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RangeStyles, getMajor, getMinVersion } from './semver.mts'

// Mock semver.
vi.mock('semver', () => ({
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
      vi.mocked(semver.coerce).mockReturnValue({ version: '1.2.3' } as any)
      vi.mocked(semver.major).mockReturnValue(1)

      const result = getMajor('1.2.3')
      expect(result).toBe(1)
      expect(semver.coerce).toHaveBeenCalledWith('1.2.3')
      expect(semver.major).toHaveBeenCalledWith({ version: '1.2.3' })
    })

    it('returns undefined when coerce returns null', () => {
      vi.mocked(semver.coerce).mockReturnValue(null)

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
      vi.mocked(semver.coerce).mockReturnValue(null)

      expect(getMajor(123)).toBeUndefined()
      expect(getMajor(null)).toBeUndefined()
      expect(getMajor(undefined)).toBeUndefined()
      expect(getMajor({})).toBeUndefined()
    })
  })

  describe('getMinVersion', () => {
    it('returns min version for valid range', () => {
      const mockSemVer = { version: '1.0.0' } as any
      vi.mocked(semver.minVersion).mockReturnValue(mockSemVer)

      const result = getMinVersion('^1.0.0')
      expect(result).toBe(mockSemVer)
      expect(semver.minVersion).toHaveBeenCalledWith('^1.0.0')
    })

    it('returns undefined when minVersion returns null', () => {
      vi.mocked(semver.minVersion).mockReturnValue(null)

      const result = getMinVersion('invalid-range')
      expect(result).toBeUndefined()
    })

    it('returns undefined when minVersion throws', () => {
      vi.mocked(semver.minVersion).mockImplementation(() => {
        throw new Error('Invalid range')
      })

      const result = getMinVersion('bad-range')
      expect(result).toBeUndefined()
    })

    it('handles non-string input', () => {
      vi.mocked(semver.minVersion).mockReturnValue(null)

      expect(getMinVersion(123)).toBeUndefined()
      expect(getMinVersion(null)).toBeUndefined()
      expect(getMinVersion(undefined)).toBeUndefined()
      expect(getMinVersion([])).toBeUndefined()
    })
  })
})
