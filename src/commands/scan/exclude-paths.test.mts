import { describe, expect, it } from 'vitest'

import {
  applyFullExcludePaths,
  assertNoNegationPatterns,
  excludePathToProjectIgnorePath,
  projectIgnorePathsToReachExcludePaths,
} from './exclude-paths.mts'
import { InputError } from '../../utils/errors.mts'

import type { ReachabilityOptions } from './perform-reachability-analysis.mts'

function makeReachOptions(
  overrides: Partial<ReachabilityOptions> = {},
): ReachabilityOptions {
  return {
    excludePaths: [],
    reachAnalysisMemoryLimit: 8192,
    reachAnalysisTimeout: 0,
    reachConcurrency: 1,
    reachContinueOnAnalysisErrors: false,
    reachContinueOnInstallErrors: false,
    reachContinueOnMissingLockFiles: false,
    reachContinueOnNoSourceFiles: false,
    reachDebug: false,
    reachDetailedAnalysisLogFile: false,
    reachDisableAnalytics: false,
    reachDisableExternalToolChecks: false,
    reachEcosystems: [],
    reachEnableAnalysisSplitting: false,
    reachExcludePaths: [],
    reachLazyMode: false,
    reachSkipCache: false,
    reachUseOnlyPregeneratedSboms: false,
    reachVersion: undefined,
    ...overrides,
  }
}

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
    ])('anchors %s as %s for the SCA gitignore matcher', (input, expected) => {
      expect(excludePathToProjectIgnorePath(input)).toBe(expected)
    })
  })

  describe('projectIgnorePathsToReachExcludePaths', () => {
    it('passes patterns through verbatim when target equals project root', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(
          ['tests', 'dist/', 'fixtures/**'],
          {
            cwd: '/repo',
            target: '/repo',
          },
        ),
      ).toEqual(['tests', 'dist', 'fixtures/**'])
    })

    it('treats a literal "." target the same as project root', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(['tests', 'fixtures/**'], {
          cwd: '/repo',
          target: '.',
        }),
      ).toEqual(['tests', 'fixtures/**'])
    })

    it('normalizes leading dot-slash targets before re-anchoring', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(['apps/api/tests'], {
          cwd: '/repo',
          target: './apps/api',
        }),
      ).toEqual(['tests'])
    })

    it('does not send a Coana exclude when the exclude names the whole target', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(['apps/api'], {
          cwd: '/repo',
          target: '/repo/apps/api',
        }),
      ).toEqual([])
    })

    it('strips the target prefix and drops out-of-target patterns for nested targets', () => {
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

    it('strips trailing slashes when re-anchoring under a nested target', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(
          ['apps/api/tests/', 'apps/api/build/'],
          {
            cwd: '/repo',
            target: '/repo/apps/api',
          },
        ),
      ).toEqual(['tests', 'build'])
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
    it('keeps socket.yml projectIgnorePaths on the SCA side without forwarding them to reachability', () => {
      const result = applyFullExcludePaths({
        cwd: '/repo',
        reachabilityOptions: makeReachOptions({
          excludePaths: ['tests'],
        }),
        socketConfig: {
          version: 2,
          issueRules: {},
          githubApp: {},
          projectIgnorePaths: ['fixtures/**', '!fixtures/keep'],
        },
        target: '/repo',
      })

      expect(result.effectiveSocketConfig?.projectIgnorePaths).toEqual([
        'fixtures/**',
        '!fixtures/keep',
        'tests/**',
      ])
      expect(result.mergedReachabilityOptions.reachExcludePaths).toEqual([
        'tests',
      ])
    })
  })
})
