import { describe, expect, it } from 'vitest'

import {
  applyFullExcludePaths,
  assertValidExcludePaths,
  excludePathToScanIgnores,
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
  describe('assertValidExcludePaths', () => {
    it('allows positive patterns', () => {
      expect(() =>
        assertValidExcludePaths(['tests', 'packages/*', 'a/b/c']),
      ).not.toThrow()
    })

    it('rejects negation patterns', () => {
      expect(() => assertValidExcludePaths(['!tests/keep'])).toThrow(InputError)
      expect(() => assertValidExcludePaths(['!tests/keep'])).toThrow(
        "--exclude-paths does not support negation patterns. Got: '!tests/keep'.",
      )
    })

    it.each(['', '.', './', './**', '/', '**', '/**'])(
      'rejects match-everything sentinel %j',
      input => {
        expect(() => assertValidExcludePaths([input])).toThrow(
          /match-everything|negation|absolute/,
        )
      },
    )

    it.each(['/repo/tests', '/etc/passwd'])(
      'rejects absolute path %j',
      input => {
        expect(() => assertValidExcludePaths([input])).toThrow(/absolute path/)
      },
    )

    it.each(['..', '../tests', 'apps/../tests'])(
      'rejects path %j that escapes scan root via ..',
      input => {
        expect(() => assertValidExcludePaths([input])).toThrow(
          /cannot escape the scan root/,
        )
      },
    )
  })

  describe('excludePathToScanIgnores', () => {
    it.each<[string, string[]]>([
      ['packages/*', ['packages/*', 'packages/*/**']],
      ['tests', ['tests', 'tests/**']],
      ['tests/', ['tests', 'tests/**']],
      ['tests/**', ['tests/**']],
    ])('expands %s to %j for the fast-glob ignore set', (input, expected) => {
      expect(excludePathToScanIgnores(input)).toEqual(expected)
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

    it('preserves match-anywhere globs for nested targets', () => {
      expect(
        projectIgnorePathsToReachExcludePaths(['**/dist'], {
          cwd: '/repo',
          target: '/repo/apps/api',
        }),
      ).toEqual(['**/dist'])
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
    it('expands exclude-paths into SCA ignores and re-anchored Coana excludes', () => {
      const result = applyFullExcludePaths({
        cwd: '/repo',
        reachabilityOptions: makeReachOptions({
          excludePaths: ['tests'],
        }),
        target: '/repo',
      })

      expect(result.additionalScaIgnores).toEqual(['tests', 'tests/**'])
      expect(result.mergedReachabilityOptions.reachExcludePaths).toEqual([
        'tests',
      ])
    })
  })
})
