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
  pathRelativeToTarget,
  projectIgnorePathsToReachExcludePaths,
} from '../../../../src/commands/scan/exclude-paths.mts'
import { InputError } from '../../../../src/util/error/errors.mts'

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

    it('passes ** through verbatim from expandReachExcludePath', () => {
      // Path that exactly equals target → translates to '**'.
      expect(
        projectIgnorePathsToReachExcludePaths(['apps/api'], {
          cwd: '/repo',
          target: 'apps/api',
        }),
      ).toEqual(['**'])
    })

    it('strips recursive ${target}/**/ prefix (line 175-178)', () => {
      // When the path begins with target/**/, only the targetPrefix is
      // sliced off; the **/ remainder stays. (The wrapping
      // projectIgnorePaths→reach expansion adds the trailing /** variant.)
      expect(
        projectIgnorePathsToReachExcludePaths(['apps/api/**/dist'], {
          cwd: '/repo',
          target: 'apps/api',
        }),
      ).toEqual(['**/dist', '**/dist/**'])
    })
  })

  describe('applyFullExcludePaths', () => {
    it('returns input config unchanged when no exclude paths are provided', () => {
      const reachabilityOptions = {
        excludePaths: [],
        reachExcludePaths: ['existing'],
      } as unknown
      const socketConfig = { foo: 'bar' } as unknown

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
      } as unknown
      const socketConfig = {
        version: 2,
        issueRules: { x: true },
        githubApp: {},
        projectIgnorePaths: ['cfg-ignore'],
      } as unknown

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
        } as unknown,
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

  describe('pathRelativeToTarget', () => {
    it('returns the normalized path when target is "."', () => {
      expect(pathRelativeToTarget('foo/bar', '.')).toBe('foo/bar')
    })

    it('returns the normalized path when target is empty string', () => {
      expect(pathRelativeToTarget('foo/bar', '')).toBe('foo/bar')
    })

    it('returns "**" when path equals target', () => {
      expect(pathRelativeToTarget('packages/cli', 'packages/cli')).toBe('**')
    })

    it('strips the target prefix from a nested path', () => {
      expect(pathRelativeToTarget('packages/cli/src/foo', 'packages/cli')).toBe(
        'src/foo',
      )
    })

    it('strips the target prefix when path uses recursive **/  prefix (line 177)', () => {
      // path = "packages/cli/**/dist/foo" with target = "packages/cli"
      // → matches recursiveTargetPrefix "packages/cli/**/" branch.
      expect(
        pathRelativeToTarget('packages/cli/**/dist/foo', 'packages/cli'),
      ).toBe('**/dist/foo')
    })

    it('returns undefined when path is outside the target', () => {
      expect(pathRelativeToTarget('other/dir', 'packages/cli')).toBeUndefined()
    })
  })
})
