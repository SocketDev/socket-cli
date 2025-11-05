/**
 * @fileoverview Unit tests for maintained Node.js versions data module.
 *
 * Tests maintained Node.js versions constant:
 * - Default export contains array of actively maintained Node.js major versions
 * - Data is frozen to prevent runtime modifications
 * - Version format validation (numeric major versions)
 * - Sorted in ascending order
 * Used by Socket tools to validate Node.js version compatibility and requirements.
 */

import { describe, expect, it } from 'vitest'

import maintainedNodeVersionsModule from '@socketsecurity/lib/maintained-node-versions'

// Handle ESM/CJS interop - the module may be double-wrapped
const maintainedNodeVersions =
  (maintainedNodeVersionsModule as any).default || maintainedNodeVersionsModule

describe('maintained-node-versions', () => {
  describe('default export', () => {
    it('should export an array', () => {
      expect(Array.isArray(maintainedNodeVersions)).toBe(true)
    })

    it('should be frozen', () => {
      expect(Object.isFrozen(maintainedNodeVersions)).toBe(true)
    })

    it('should have exactly 4 versions', () => {
      expect(maintainedNodeVersions).toHaveLength(4)
    })

    it('should contain only strings', () => {
      maintainedNodeVersions.forEach(version => {
        expect(typeof version).toBe('string')
      })
    })
  })

  describe('named properties', () => {
    it('should have current property', () => {
      expect(maintainedNodeVersions).toHaveProperty('current')
      expect(typeof maintainedNodeVersions.current).toBe('string')
    })

    it('should have last property', () => {
      expect(maintainedNodeVersions).toHaveProperty('last')
      expect(typeof maintainedNodeVersions.last).toBe('string')
    })

    it('should have next property', () => {
      expect(maintainedNodeVersions).toHaveProperty('next')
      expect(typeof maintainedNodeVersions.next).toBe('string')
    })

    it('should have previous property', () => {
      expect(maintainedNodeVersions).toHaveProperty('previous')
      expect(typeof maintainedNodeVersions.previous).toBe('string')
    })
  })

  describe('array contents', () => {
    it('should have versions in order: last, previous, current, next', () => {
      const [first, second, third, fourth] = maintainedNodeVersions
      expect(first).toBe(maintainedNodeVersions.last)
      expect(second).toBe(maintainedNodeVersions.previous)
      expect(third).toBe(maintainedNodeVersions.current)
      expect(fourth).toBe(maintainedNodeVersions.next)
    })

    it('should have valid semver format for all versions', () => {
      const semverPattern = /^\d+\.\d+\.\d+$/
      maintainedNodeVersions.forEach(version => {
        expect(version).toMatch(semverPattern)
      })
    })

    it('should have versions in ascending order', () => {
      const versions = [...maintainedNodeVersions]
      const sortedVersions = versions
        .map(v => v.split('.').map(Number))
        .sort((a, b) => {
          for (let i = 0; i < 3; i++) {
            if (a[i] !== b[i]) {
              return a[i] - b[i]
            }
          }
          return 0
        })
        .map(v => v.join('.'))

      expect(versions).toEqual(sortedVersions)
    })
  })

  describe('version properties match array', () => {
    it('should have current in array', () => {
      expect(maintainedNodeVersions).toContain(maintainedNodeVersions.current)
    })

    it('should have last in array', () => {
      expect(maintainedNodeVersions).toContain(maintainedNodeVersions.last)
    })

    it('should have next in array', () => {
      expect(maintainedNodeVersions).toContain(maintainedNodeVersions.next)
    })

    it('should have previous in array', () => {
      expect(maintainedNodeVersions).toContain(maintainedNodeVersions.previous)
    })
  })

  describe('immutability', () => {
    it('should not allow modification of array elements', () => {
      expect(() => {
        maintainedNodeVersions[0] = '99.99.99'
      }).toThrow()
    })

    it('should not allow push', () => {
      expect(() => {
        maintainedNodeVersions.push('99.99.99')
      }).toThrow()
    })

    it('should not allow pop', () => {
      expect(() => {
        maintainedNodeVersions.pop()
      }).toThrow()
    })

    it('should not allow modification of named properties', () => {
      expect(() => {
        maintainedNodeVersions.current = '99.99.99'
      }).toThrow()
    })
  })

  describe('version relationships', () => {
    it('should have current >= previous', () => {
      const current = maintainedNodeVersions.current.split('.').map(Number)
      const previous = maintainedNodeVersions.previous.split('.').map(Number)

      const currentMajor = current[0]
      const previousMajor = previous[0]

      expect(currentMajor).toBeGreaterThanOrEqual(previousMajor)
    })

    it('should have previous >= last', () => {
      const previous = maintainedNodeVersions.previous.split('.').map(Number)
      const last = maintainedNodeVersions.last.split('.').map(Number)

      const previousMajor = previous[0]
      const lastMajor = last[0]

      expect(previousMajor).toBeGreaterThanOrEqual(lastMajor)
    })

    it('should have next >= current', () => {
      const next = maintainedNodeVersions.next.split('.').map(Number)
      const current = maintainedNodeVersions.current.split('.').map(Number)

      const nextMajor = next[0]
      const currentMajor = current[0]

      expect(nextMajor).toBeGreaterThanOrEqual(currentMajor)
    })
  })

  describe('realistic version numbers', () => {
    it('should have major versions in reasonable range', () => {
      maintainedNodeVersions.forEach(version => {
        const major = Number.parseInt(version.split('.')[0], 10)
        expect(major).toBeGreaterThanOrEqual(10)
        expect(major).toBeLessThanOrEqual(100)
      })
    })

    it('should have minor versions in valid range', () => {
      maintainedNodeVersions.forEach(version => {
        const minor = Number.parseInt(version.split('.')[1], 10)
        expect(minor).toBeGreaterThanOrEqual(0)
        expect(minor).toBeLessThanOrEqual(99)
      })
    })

    it('should have patch versions in valid range', () => {
      maintainedNodeVersions.forEach(version => {
        const patch = Number.parseInt(version.split('.')[2], 10)
        expect(patch).toBeGreaterThanOrEqual(0)
        expect(patch).toBeLessThanOrEqual(99)
      })
    })
  })

  describe('array operations', () => {
    it('should support forEach iteration', () => {
      const versions: string[] = []
      maintainedNodeVersions.forEach(v => versions.push(v))
      expect(versions).toHaveLength(4)
    })

    it('should support map operation', () => {
      const majors = maintainedNodeVersions.map(v =>
        Number.parseInt(v.split('.')[0], 10),
      )
      expect(majors).toHaveLength(4)
      majors.forEach(m => expect(typeof m).toBe('number'))
    })

    it('should support filter operation', () => {
      const filtered = maintainedNodeVersions.filter(v => v.startsWith('2'))
      expect(Array.isArray(filtered)).toBe(true)
    })

    it('should support find operation', () => {
      const found = maintainedNodeVersions.find(
        v => v === maintainedNodeVersions.current,
      )
      expect(found).toBe(maintainedNodeVersions.current)
    })

    it('should support includes operation', () => {
      expect(
        maintainedNodeVersions.includes(maintainedNodeVersions.current),
      ).toBe(true)
      expect(maintainedNodeVersions.includes('99.99.99')).toBe(false)
    })

    it('should support slice operation', () => {
      const sliced = maintainedNodeVersions.slice(0, 2)
      expect(sliced).toHaveLength(2)
      expect(sliced[0]).toBe(maintainedNodeVersions.last)
      expect(sliced[1]).toBe(maintainedNodeVersions.previous)
    })

    it('should support spread operator', () => {
      const spread = [...maintainedNodeVersions]
      expect(spread).toHaveLength(4)
      expect(spread[0]).toBe(maintainedNodeVersions[0])
    })

    it('should support destructuring', () => {
      const [first, second, third, fourth] = maintainedNodeVersions
      expect(first).toBe(maintainedNodeVersions.last)
      expect(second).toBe(maintainedNodeVersions.previous)
      expect(third).toBe(maintainedNodeVersions.current)
      expect(fourth).toBe(maintainedNodeVersions.next)
    })
  })

  describe('edge cases', () => {
    it('should handle string operations on versions', () => {
      maintainedNodeVersions.forEach(version => {
        expect(version.length).toBeGreaterThan(0)
        expect(version.includes('.')).toBe(true)
        expect(version.split('.').length).toBe(3)
      })
    })

    it('should not have duplicates', () => {
      const unique = new Set(maintainedNodeVersions)
      expect(unique.size).toBe(maintainedNodeVersions.length)
    })

    it('should not have empty strings', () => {
      maintainedNodeVersions.forEach(version => {
        expect(version.length).toBeGreaterThan(0)
        expect(version.trim()).toBe(version)
      })
    })
  })
})
