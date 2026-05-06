/**
 * Unit tests for exclude-paths helpers.
 *
 * Validates the helpers that translate the user-facing --exclude-paths flag
 * into projectIgnorePaths and Coana --exclude-dirs values.
 */

import { describe, expect, it } from 'vitest'

import {
  assertNoNegationPatterns,
  excludePathToProjectIgnorePath,
  normalizeExcludePath,
  projectIgnorePathsToReachExcludePaths,
} from '../../../../src/commands/scan/exclude-paths.mts'
import { InputError } from '../../../../src/utils/error/errors.mts'

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
        projectIgnorePathsToReachExcludePaths(
          ['tests', 'dist/', 'fixtures/**'],
          {
            cwd: '/repo',
            target: '/repo',
          },
        ),
      ).toEqual([
        '**/tests',
        '**/tests/**',
        '**/dist',
        '**/dist/**',
        'fixtures/**',
      ])
    })

    it('keeps project-root paths relative to nested Coana targets', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(
          ['tests/**', 'apps/api/tests/**', 'apps/api/packages/*/**'],
          {
            cwd: '/repo',
            target: '/repo/apps/api',
          },
        ),
      ).toEqual(['tests/**', 'packages/*/**'])
    })

    it('returns no paths when project ignore paths use negation', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(
          ['fixtures/**', '!fixtures/keep'],
          {
            cwd: '/repo',
            target: '/repo',
          },
        ),
      ).toEqual([])
    })
  })
})
