/**
 * Unit tests for exclude-paths helpers.
 *
 * Validates the helpers that translate the user-facing --exclude-paths flag
 * into projectIgnorePaths and Coana --exclude-dirs values.
 */

import { describe, expect, it } from 'vitest'

import {
  applyFullExcludePaths,
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

  describe('applyFullExcludePaths', () => {
    it('returns input config unchanged when no exclude paths are provided', () => {
      const reachabilityOptions = {
        excludePaths: [],
        reachExcludePaths: ['existing'],
      } as any
      const socketConfig = { foo: 'bar' } as any

      const result = applyFullExcludePaths({
        cwd: '/repo',
        reachabilityOptions,
        socketConfig,
        target: '.',
      })

      expect(result.effectiveSocketConfig).toBe(socketConfig)
      expect(result.mergedReachabilityOptions).toBe(reachabilityOptions)
    })

    it('merges excludePaths into projectIgnorePaths and reach excludes', () => {
      const reachabilityOptions = {
        excludePaths: ['tests', 'fixtures'],
        reachExcludePaths: ['existing-reach'],
      } as any
      const socketConfig = {
        version: 2,
        issueRules: { x: true },
        githubApp: {},
        projectIgnorePaths: ['cfg-ignore'],
      } as any

      const result = applyFullExcludePaths({
        cwd: '/repo',
        reachabilityOptions,
        socketConfig,
        target: '.',
      })

      expect(result.effectiveSocketConfig.projectIgnorePaths).toEqual(
        expect.arrayContaining(['cfg-ignore']),
      )
      expect(result.mergedReachabilityOptions.reachExcludePaths).toEqual(
        expect.arrayContaining(['existing-reach']),
      )
    })

    it('initializes config defaults when socketConfig is missing fields', () => {
      const result = applyFullExcludePaths({
        cwd: '/repo',
        reachabilityOptions: {
          excludePaths: ['tests'],
          reachExcludePaths: [],
        } as any,
        socketConfig: undefined,
        target: '.',
      })

      expect(result.effectiveSocketConfig).toBeDefined()
      expect(result.effectiveSocketConfig?.version).toBe(2)
      expect(result.effectiveSocketConfig?.projectIgnorePaths).toEqual(
        expect.arrayContaining([expect.any(String)]),
      )
    })
  })
})
