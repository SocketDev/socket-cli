/**
 * @file Fleet-canonical coverage defaults — the shape every socket-* repo
 *   shares. Repos layer their own include/exclude/threshold deltas on top via
 *   a repo-owned `.config/repo/coverage.json` overlay (same fleet-default +
 *   repo-override tiering as `.config/{fleet,repo}/vitest.json`), resolved by
 *   `resolveCoverageConfig()`. Do NOT add repo-specific paths here; anything
 *   in this file cascades to every fleet repo.
 */

import { existsSync, readFileSync } from 'node:fs'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import type { CoverageOptions } from 'vitest/node'

import { COVERAGE_SCRATCH_VITEST_DIR } from '../../scripts/fleet/paths.mts'

/**
 * Fleet-shared coverage base. Excludes cover the dirs every fleet repo has
 * (node_modules, dist, test, scripts, perf, external bundles). Repo-specific
 * deltas live in the repo's `.config/repo/coverage.json` overlay.
 */
export const baseFleetCoverageConfig: CoverageOptions = {
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
  // Reporters are CI-gated. `json` is always kept — the aggregate merge reads
  // coverage-final.json — as is the cheap `json-summary` (badge/threshold) and
  // the `text` console table. The EXPENSIVE artifact reporters (`html` writes
  // ~one page per source file, `lcov`, `clover`) only earn their keep in CI
  // (uploaded/inspected there); locally they dominate the coverage run's tail
  // for output nobody opens. getCI() is the fleet's rewire-aware CI presence
  // check (truthy for any CI value). CI output is byte-for-byte unchanged.
  reporter: getCI()
    ? ['text', 'json', 'json-summary', 'html', 'lcov', 'clover']
    : ['text', 'json', 'json-summary'],
  // Vitest tiers report into a THROWAWAY scratch dir (in os.tmpdir), not the
  // coverage home: `clean: true` wipes the whole reportsDirectory and the
  // reporter emits a fixed `coverage-final.json`, so the runner renames each
  // tier's result out to its flat `coverage-final.<tier>.json` in COVERAGE_DIR.
  // Using the scratch means the top-level `coverage/` never appears.
  reportsDirectory: COVERAGE_SCRATCH_VITEST_DIR,
  skipFull: false,
}

/**
 * Fleet-default cumulative threshold. A repo can override these in its own
 * coverage overlay when its bar is materially different — the wheelhouse
 * default is the conservative starting point.
 */
export const baseFleetAggregateThresholds = {
  branches: 95,
  functions: 99,
  lines: 99,
  statements: 99,
}

/**
 * Repo-owned coverage overlay, read from `.config/repo/coverage.json`. A repo
 * whose instrumentable code lives outside the fleet-default `src/**` shape
 * (the wheelhouse: `template/**` + `scripts/repo/**`) declares its own set
 * here instead of forking the cascaded config.
 */
export interface RepoCoverageOverlay {
  readonly exclude?:
    | {
        readonly add?: string[] | undefined
        readonly remove?: string[] | undefined
      }
    | undefined
  readonly include?: string[] | undefined
}

export const REPO_COVERAGE_OVERLAY_PATH = '.config/repo/coverage.json'

export function readRepoCoverageOverlay(
  options?: { readonly overlayPath?: string | undefined } | undefined,
): RepoCoverageOverlay {
  const opts = { __proto__: null, ...options }
  const overlayPath = opts.overlayPath ?? REPO_COVERAGE_OVERLAY_PATH
  if (!existsSync(overlayPath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(
      readFileSync(overlayPath, 'utf8'),
    ) as RepoCoverageOverlay
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // A torn overlay must not kill the test run — fall back to the fleet base
    // (the same fail-soft posture as readVitestConfigTier).
    return {}
  }
}

/**
 * Fleet base + repo overlay, merged. Overlay semantics: `include` REPLACES the
 * base include set when present (a repo with a different source shape needs a
 * different candidate set, not a union); `exclude.remove` filters entries out
 * of the base excludes (exact string match — vitest applies exclude over
 * include, so a base exclude like `scripts/**` must be removable); and
 * `exclude.add` appends repo-specific excludes.
 */
export function resolveCoverageConfig(
  options?: { readonly overlayPath?: string | undefined } | undefined,
): CoverageOptions {
  const overlay = readRepoCoverageOverlay(options)
  const removals = new Set(overlay.exclude?.remove ?? [])
  const exclude = [
    ...(baseFleetCoverageConfig.exclude ?? []).filter(
      (g: string) => !removals.has(g),
    ),
    ...(overlay.exclude?.add ?? []),
  ]
  // `include` spreads conditionally: exactOptionalPropertyTypes forbids an
  // explicit `include: undefined` on CoverageOptions.
  const include =
    overlay.include && overlay.include.length > 0
      ? [...overlay.include]
      : baseFleetCoverageConfig.include
  return {
    ...baseFleetCoverageConfig,
    exclude,
    ...(include ? { include } : {}),
  }
}
