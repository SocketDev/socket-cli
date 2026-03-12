/**
 * Unit tests for dependency entries extraction.
 *
 * Purpose:
 * Tests the getDependencyEntries function for extracting dependencies from package.json.
 *
 * Test Coverage:
 * - Extracting all dependency types
 * - Filtering undefined dependencies
 * - Null prototype handling
 *
 * Related Files:
 * - commands/optimize/get-dependency-entries.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { getDependencyEntries } from '../../../../src/commands/optimize/get-dependency-entries.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

describe('get-dependency-entries', () => {
  describe('getDependencyEntries', () => {
    it('returns all dependency types when present', () => {
      const envDetails = {
        editablePkgJson: {
          content: {
            dependencies: { lodash: '^4.17.21' },
            devDependencies: { vitest: '^2.0.0' },
            peerDependencies: { react: '>=18.0.0' },
            optionalDependencies: { fsevents: '^2.3.0' },
          },
        },
      } as EnvDetails

      const result = getDependencyEntries(envDetails)

      expect(result).toHaveLength(4)
      expect(result[0]).toEqual(['dependencies', { lodash: '^4.17.21' }])
      expect(result[1]).toEqual(['devDependencies', { vitest: '^2.0.0' }])
      expect(result[2]).toEqual(['peerDependencies', { react: '>=18.0.0' }])
      expect(result[3]).toEqual([
        'optionalDependencies',
        { fsevents: '^2.3.0' },
      ])
    })

    it('filters out undefined dependency types', () => {
      const envDetails = {
        editablePkgJson: {
          content: {
            dependencies: { lodash: '^4.17.21' },
            devDependencies: undefined,
            peerDependencies: undefined,
            optionalDependencies: undefined,
          },
        },
      } as EnvDetails

      const result = getDependencyEntries(envDetails)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(['dependencies', { lodash: '^4.17.21' }])
    })

    it('returns empty array when no dependencies present', () => {
      const envDetails = {
        editablePkgJson: {
          content: {},
        },
      } as EnvDetails

      const result = getDependencyEntries(envDetails)

      expect(result).toHaveLength(0)
    })

    it('handles only devDependencies', () => {
      const envDetails = {
        editablePkgJson: {
          content: {
            devDependencies: { typescript: '^5.0.0' },
          },
        },
      } as EnvDetails

      const result = getDependencyEntries(envDetails)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(['devDependencies', { typescript: '^5.0.0' }])
    })

    it('handles empty dependency objects', () => {
      const envDetails = {
        editablePkgJson: {
          content: {
            dependencies: {},
            devDependencies: {},
          },
        },
      } as EnvDetails

      const result = getDependencyEntries(envDetails)

      // Empty objects are truthy, so they are included.
      expect(result).toHaveLength(2)
    })

    it('returns dependencies with null prototype', () => {
      const envDetails = {
        editablePkgJson: {
          content: {
            dependencies: { lodash: '^4.17.21' },
          },
        },
      } as EnvDetails

      const result = getDependencyEntries(envDetails)

      // Check that returned object has null prototype.
      const deps = result[0]![1]
      expect(Object.getPrototypeOf(deps)).toBe(null)
    })
  })
})
