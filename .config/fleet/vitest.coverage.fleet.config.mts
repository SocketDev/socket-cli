/**
 * @file Fleet-canonical coverage defaults — the shape every socket-* repo
 *   shares. Repos layer their own include/exclude/threshold deltas on top via
 *   the `coverage` section of the ONE per-repo settings file,
 *   `.config/repo/socket-wheelhouse.json`, resolved by
 *   `resolveCoverageConfig()`. Do NOT add repo-specific paths here; anything in
 *   this file cascades to every fleet repo.
 */

import { existsSync, readFileSync } from 'node:fs'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import type { CoverageOptions } from 'vitest/node'

import { COVERAGE_SCRATCH_VITEST_DIR } from '../../scripts/fleet/paths.mts'

/**
 * Fleet-shared coverage base. Excludes cover the dirs every fleet repo has
 * (node_modules, dist, test, scripts, perf, external bundles). Repo-specific
 * deltas live in the `coverage` section of the repo's settings file
 * (.config/repo/socket-wheelhouse.json).
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
  // Emit the coverage report even when tests FAIL. Vitest defaults this to
  // false, so a single failing, or flaky, test suppresses the ENTIRE
  // coverage-final.json — the cover runner then reads no in-process tier and
  // reports the aggregate as unavailable / undercounted (built from the
  // subprocess children tier alone). That turns any transient test failure
  // into a coverage-measurement failure, a second source of gate
  // nondeterminism. The run still fails on the test failure itself (non-zero
  // exit); this only keeps the measurement honest and stable.
  reportOnFailure: true,
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
 * Repo-owned coverage overlay, read from the `coverage` section of the ONE
 * per-repo settings file, `.config/repo/socket-wheelhouse.json` (config
 * segregation — the same surface `vitest`, `cover`, and every other tunable
 * live in). A repo whose instrumentable code lives outside the fleet-default
 * `src/**` shape (the wheelhouse: `template/**` + `scripts/repo/**`; a
 * monorepo: `packages/<name>/src/**`) declares its own set here instead of
 * forking the cascaded config.
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

// The settings file, canonical location first and the repo-root dotfile as the
// one fallback a member may ship — mirrors readVitestSettings in the sibling
// vitest.config.mts so the two configs read the same file family.
const SETTINGS_FILES = [
  '.config/repo/socket-wheelhouse.json',
  '.socket-wheelhouse.json',
] as const

/**
 * The `coverage` section of the settings file. `settingsPath` overrides the
 * lookup for a unit test; production reads the SETTINGS_FILES in order and
 * stops at the first present. A torn or absent file, or an absent/ malformed
 * `coverage` key, degrades to the empty overlay (fleet base) — the same
 * fail-soft posture as readVitestSettings.
 */
export function readRepoCoverageOverlay(
  options?: { readonly settingsPath?: string | undefined } | undefined,
): RepoCoverageOverlay {
  const opts = { __proto__: null, ...options }
  const files = opts.settingsPath ? [opts.settingsPath] : SETTINGS_FILES
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (!existsSync(file)) {
      continue
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        coverage?: RepoCoverageOverlay | undefined
      }
      const section = parsed?.coverage
      return section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {}
    } catch {
      // A torn settings file must not kill the test run — fall back to the
      // fleet base (the same fail-soft posture as readVitestSettings).
      return {}
    }
  }
  return {}
}

/**
 * Fleet base + repo overlay (the settings file's `coverage` section), merged.
 * Overlay semantics: `include` REPLACES the
 * base include set when present (a repo with a different source shape needs a
 * different candidate set, not a union); `exclude.remove` filters entries out
 * of the base excludes (exact string match — vitest applies exclude over
 * include, so a base exclude like `scripts/**` must be removable); and
 * `exclude.add` appends repo-specific excludes.
 */
export function resolveCoverageConfig(
  options?: { readonly settingsPath?: string | undefined } | undefined,
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
