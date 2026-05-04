import { describe, expect, it } from 'vitest'

import {
  assertNoNegationPatterns,
  excludePathToProjectIgnorePath,
  normalizeExcludePath,
  projectIgnorePathsToReachExcludePaths,
} from './exclude-paths.mts'
import { InputError } from '../../utils/errors.mts'

describe('exclude-paths', () => {
  describe('assertNoNegationPatterns', () => {
    it('allows positive patterns', () => {
      expect(() =>
        assertNoNegationPatterns(['tests', 'packages/*']),
      ).not.toThrow()
    })

    it('rejects negation patterns', () => {
      expect(() => assertNoNegationPatterns(['!tests/keep'])).toThrow(
        InputError,
      )
      expect(() => assertNoNegationPatterns(['!tests/keep'])).toThrow(
        "--exclude-paths does not support negation patterns. Got: '!tests/keep'.",
      )
    })
  })

  describe('excludePathToProjectIgnorePath', () => {
    it.each([
      ['packages/*', 'packages/*/**'],
      ['tests', 'tests/**'],
      ['tests/', 'tests/**'],
      ['tests/**', 'tests/**'],
    ])('converts %s to %s', (input, expected) => {
      expect(excludePathToProjectIgnorePath(input)).toBe(expected)
    })
  })

  describe('normalizeExcludePath', () => {
    it.each([
      ['tests', 'tests/**'],
      ['tests/', 'tests/**'],
      ['tests/*', 'tests/*'],
      ['tests/**', 'tests/**'],
    ])('normalizes %s to %s', (input, expected) => {
      expect(normalizeExcludePath(input)).toBe(expected)
    })
  })

  describe('projectIgnorePathsToReachExcludePaths', () => {
    it('normalizes positive project ignore paths for Coana', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(['tests', 'dist/', 'fixtures/**']),
      ).toEqual([
        '**/tests',
        '**/tests/**',
        '**/dist',
        '**/dist/**',
        'fixtures/**',
      ])
    })

    it('returns no paths when project ignore paths use negation', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(['fixtures/**', '!fixtures/keep']),
      ).toEqual([])
    })
  })
})
