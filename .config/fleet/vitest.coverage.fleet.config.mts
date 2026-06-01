/**
 * @file Fleet-canonical coverage defaults — the shape every socket-* repo
 *   shares. Repos layer their own exclude entries + thresholds on top via
 *   .config/vitest.coverage.config.mts. Do NOT add repo-specific paths here;
 *   anything in this file cascades to every fleet repo.
 */

import type { CoverageOptions } from 'vitest'

/**
 * Fleet-shared coverage base. Excludes cover the dirs every fleet repo has
 * (node_modules, dist, test, scripts, perf, external bundles). Repo-specific
 * source paths to skip (integration-only modules, generated artifacts) get
 * appended in the repo's own coverage config.
 */
export const baseFleetCoverageConfig: CoverageOptions = {
  all: true,
  clean: true,
  exclude: [
    '**/*.config.*',
    '**/node_modules/**',
    '**/[.]**',
    '**/*.d.ts',
    '**/virtual:*',
    'coverage/**',
    'test/**',
    'packages/**',
    'perf/**',
    'dist/**',
    '**/dist/**',
    '**/{dist,build,out}/**',
    'src/external/**',
    'dist/external/**',
    '**/external/**',
    'src/types.ts',
    'scripts/**',
  ],
  excludeAfterRemap: true,
  ignoreClassMethods: ['constructor'],
  include: ['src/**/*.{ts,mts,cts}', '!src/external/**'],
  provider: 'v8',
  reporter: ['text', 'json', 'json-summary', 'html', 'lcov', 'clover'],
  skipFull: false,
}

/**
 * Fleet-default cumulative threshold. A repo can override these in its own
 * coverage config when its bar is materially different — the wheelhouse default
 * is the conservative starting point.
 */
export const baseFleetAggregateThresholds = {
  branches: 95,
  functions: 99,
  lines: 99,
  statements: 99,
}
