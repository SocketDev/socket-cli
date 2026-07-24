/**
 * @file Vitest configuration. Isolation: the fleet default is `isolate: true` —
 *   each test file gets a fresh module registry + globals, so cross-file
 *   leakage (process.env, path-rewire overrides, vi.mock state, nock
 *   interceptors) is impossible. Correctness by default. A repo that wants the
 *   faster shared-worker mode for a known-safe subset opts those files OUT by
 *   listing globs in a repo-owned `.config/repo/vitest-non-isolated.json` (`{
 *   "include": ["test/unit/pure/**"] }`). When that file exists, those globs
 *   run in a second, non-isolated project and the default isolated project
 *   excludes them. No file → everything isolated.
 */
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib-stable/env/boolean'
import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { defineConfig } from 'vitest/config'

import { GENERATED_GLOBS } from '../../scripts/fleet/constants/generated-globs.mts'
import { resolveCoverageConfig } from '../fleet/vitest.coverage.fleet.config.mts'

// Coverage is on when the COVERAGE env is set (cover.mts) or the `--coverage`
// flag is passed. Match the FLAG, not any argv containing the substring
// "coverage" — a nested test run whose file-path args happen to include
// "coverage" must not silently turn coverage on and clean the shared
// coverage/.tmp (see test.mts resolveVitestEnv).
const isCoverageEnabled =
  envAsBoolean(process.env['COVERAGE']) ||
  process.argv.some(arg => arg.startsWith('--coverage'))

// One repo-tunable vitest config, resolved fleet-default + repo-override (the
// same shape as .config/{fleet,repo}/git-authors.json):
//   nonIsolated        — globs safe to run in the faster non-isolated pool.
//   nodeTestExclude    — extra node:test homes to exclude from vitest discovery
//                        (e.g. `tools/**/test/**` for a `node --test` tool corpus).
//                        prefer-vitest-guard reads the SAME key so its allowlist
//                        and this exclude never drift.
// Array values from both tiers are concatenated (a repo extends, never shrinks,
// the fleet defaults). Replaces the former vitest-non-isolated.json +
// vitest-extra-exclude.json sidecars.
export interface VitestRepoConfig {
  maxWorkers?: number | undefined
  nonIsolated?: string[] | undefined
  nodeTestExclude?: string[] | undefined
  pool?: 'forks' | 'threads' | undefined
}
/**
 * Test LANES — a SPEED category, orthogonal to test TYPE (unit/integration/e2e)
 * — from the `vitest.lanes` section of the canonical per-repo settings file
 * (.config/repo/socket-wheelhouse.json; see paths.mts's resolver order for the
 * fallbacks). `slow` = heavy suites (subprocess-per-case, e.g. hook integration
 * specs); `mid` = isolated in-process suites (env-mutating / vi.mock /
 * fs-heavy); `fast` = the implicit complement (pure in-process). The runner's
 * `--lane <fast|mid|slow>` flag (scripts/fleet/test.mts) selects one, and bare
 * `pnpm test` defaults to `fast` for a quick local loop. The lane filter is
 * INERT under coverage and for an unset FLEET_LANE (an --all / scoped / cover
 * run), so coverage + CI run EVERY lane — the split shapes only the fast local
 * feedback loop and never removes a suite from the gate.
 */
export interface VitestLanes {
  mid?: string[] | undefined
  slow?: string[] | undefined
}
export function readVitestLanes(): VitestLanes {
  for (const file of [
    '.config/repo/socket-wheelhouse.json',
    '.config/socket-wheelhouse.json',
    '.socket-wheelhouse.json',
  ]) {
    if (!existsSync(file)) {
      continue
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        vitest?: { lanes?: VitestLanes | undefined } | undefined
      }
      const lanes = parsed?.vitest?.lanes
      const clean = (a: unknown): string[] =>
        Array.isArray(a)
          ? a.filter((g): g is string => typeof g === 'string')
          : []
      return lanes && typeof lanes === 'object'
        ? { mid: clean(lanes.mid), slow: clean(lanes.slow) }
        : {}
    } catch {
      return {}
    }
  }
  return {}
}
export function readNonIsolatedGlobs(): string[] {
  return resolveVitestKey('nonIsolated')
}
export function readVitestConfigTier(file: string): VitestRepoConfig {
  if (!existsSync(file)) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as VitestRepoConfig
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
export function repoNodeTestExcludeGlobs(): string[] {
  return resolveVitestKey('nodeTestExclude')
}
export function resolveFallbackMaxWorkers(): number {
  if (getCI()) {
    return 4
  }
  return isCoverageEnabled ? 8 : 16
}
export function resolveConfiguredMaxWorkers(): number | undefined {
  const fleet = readVitestConfigTier('.config/fleet/vitest.json').maxWorkers
  const repo = readVitestConfigTier('.config/repo/vitest.json').maxWorkers
  const candidates = [fleet, repo].filter(
    (v): v is number => typeof v === 'number' && v > 0,
  )
  return candidates.length > 0 ? Math.min(...candidates) : undefined
}
export function capMaxWorkers(
  configuredMaxWorkers: number | undefined,
  fallbackMaxWorkers: number,
): number {
  return configuredMaxWorkers === undefined
    ? fallbackMaxWorkers
    : Math.min(configuredMaxWorkers, fallbackMaxWorkers)
}
export function resolveMaxWorkers(): number {
  return capMaxWorkers(
    resolveConfiguredMaxWorkers(),
    resolveFallbackMaxWorkers(),
  )
}
export function resolvePool(): 'forks' | 'threads' {
  const fleet = readVitestConfigTier('.config/fleet/vitest.json').pool
  const repo = readVitestConfigTier('.config/repo/vitest.json').pool
  const chosen = repo ?? fleet
  return chosen === 'forks' || chosen === 'threads' ? chosen : 'threads'
}
export function resolveVitestKey(key: keyof VitestRepoConfig): string[] {
  const fleet = readVitestConfigTier('.config/fleet/vitest.json')[key]
  const repo = readVitestConfigTier('.config/repo/vitest.json')[key]
  return [
    ...(Array.isArray(fleet) ? fleet : []),
    ...(Array.isArray(repo) ? repo : []),
  ].filter(g => typeof g === 'string')
}
const nonIsolatedGlobs = readNonIsolatedGlobs()

// Lane resolution. The runner sets FLEET_LANE (bare `pnpm test` → 'fast'); the
// filter is inert under coverage and for an unset lane, so --all / scoped /
// cover runs traverse every lane (nothing is cut from the gate).
const vitestLanes = readVitestLanes()
const slowLaneGlobs = vitestLanes.slow ?? []
const midLaneGlobs = vitestLanes.mid ?? []
const activeLane = process.env['FLEET_LANE']
const laneFilterActive =
  !isCoverageEnabled &&
  (activeLane === 'fast' || activeLane === 'mid' || activeLane === 'slow')
// A lane's dir globs → test-file include patterns (`--lane mid|slow` runs ONLY
// that lane; a trailing `/**` becomes `/**/*.test.{…}`).
const laneToTestGlobs = (globs: string[]): string[] =>
  globs.map(g => `${g.replace(/\/\*+$/, '')}/**/*.test.{js,ts,mjs,mts,cjs}`)

export default defineConfig({
  test: {
    deps: {
      interopDefault: false,
    },
    server: {
      deps: {
        // Treat @socketsecurity/lib-stable as external — bypass vite's
        // transform pipeline so Node resolves it natively (CJS default
        // condition). Without this, vite's `development` condition resolves
        // lib-stable via its `source` exports field (TypeScript source), and
        // the TS source files reference `./external/semver` sub-paths that are
        // not listed in the lib-stable exports map, producing an unhandled
        // EnvironmentPluginContainer.resolveId error that kills the test run.
        external: [/node_modules\/@socketsecurity\/lib-stable/],
      },
    },
    globals: false,
    environment: 'node',
    // Test setup lives under test/scripts/{fleet,repo}/setup.mts — fleet-canonical
    // setup (nock fail-closed, env scrubbing) in fleet/, repo-specific setup in
    // repo/. Both are optional: vitest skips a setupFile that doesn't exist via
    // the existsSync filter so scaffolding-only repos don't error.
    setupFiles: [
      'test/fleet/scripts/setup.mts',
      'test/repo/scripts/setup.mts',
    ].filter(p => existsSync(p)),
    // `--lane mid|slow` runs ONLY that lane (include = its globs); every other
    // run (bare-fast, --all, scoped, cover) uses the full-suite glob and lets
    // the exclude below drop the fast-lane's mid+slow. `**/`-anchored so a
    // monorepo's nested `packages/<name>/test/**` trees are discovered from this
    // one root config — a bare `test/**/*.test...` only anchors at the repo
    // root, silently missing every sub-package's tests (each scoped `vitest run`
    // returns "No test files found" and a full run "passes" having executed
    // zero of them).
    include:
      laneFilterActive && activeLane === 'mid'
        ? laneToTestGlobs(midLaneGlobs)
        : laneFilterActive && activeLane === 'slow'
          ? laneToTestGlobs(slowLaneGlobs)
          : ['**/test/**/*.test.{js,ts,mjs,mts,cjs}'],
    // Vitest treats `test/**` as `**/test/**`, so without an explicit
    // exclude it picks up every nested `test/` directory in the repo
    // — including the `.git-hooks/test/`, the oxlint plugin's per-rule
    // `.config/fleet/oxlint-plugin/fleet/<id>/test/` suites,
    // and `scripts/**/test/` suites that run under `node --test`, not
    // vitest. Those tests use `import { test } from 'node:test'` and
    // produce zero vitest suites, which vitest reports as failures.
    // List the known node:test homes here so vitest skips them cleanly
    // (their own `node --test` runners pick them up separately).
    exclude: [
      '**/node_modules/**',
      // Generated/vendored trees (dist, build, upstream, test/fixtures, …) —
      // shared with lint + format from one source (constants/generated-globs.mts)
      // so the ignore surfaces can't drift. vite's default loader can't
      // transform many of these (a module-graph walk into a vendored tree or a
      // wasm blob fails "ESM integration proposal for Wasm"), so discovery AND
      // `vitest related` must skip them; scripts/fleet/test.mts filters the same
      // set from the staged pre-commit run.
      ...GENERATED_GLOBS,
      '**/.{idea,git,cache,output,temp}/**',
      '.git-hooks/**',
      '.config/fleet/oxlint-plugin/**',
      'scripts/**/test/**',
      '.claude/hooks/**/test/**',
      // Ephemeral git worktrees (sub-agent / companion sessions) carry a full
      // checkout — their test copies would pollute the primary's discovery and
      // fail against code the primary has already moved past.
      '**/.claude/worktrees/**',
      // `template/**` holds CANONICAL non-test sources (the cascaded LIVE
      // copies are what the suite runs); live test/repo is the sole test
      // authoring home, so template is excluded unconditionally.
      'template/**',
      // `test/isolated/**` is the isolated SUITE's turf — its own forks / longer
      // -timeout config (`vitest.config.isolated.mts`), run as a separate suite
      // by cover.mts. Exclude it from this shared suite ONLY when the repo ships
      // that config, so a repo without the isolated suite still runs any
      // `test/isolated` files here instead of silently dropping them. This is the
      // isolated DIRECTORY tier — distinct from the `isolate:` state-isolation
      // split (the `nonIsolated` projects) further down.
      ...(existsSync('.config/repo/vitest.config.isolated.mts')
        ? ['test/isolated/**']
        : []),
      // Repo-tunable node:test homes (e.g. `tools/**/test/**`) from the
      // `nodeTestExclude` key of .config/{fleet,repo}/vitest.json. The same key
      // feeds prefer-vitest-guard's allowlist so the two never drift.
      ...repoNodeTestExcludeGlobs(),
      // Fast lane (`--lane fast`, the bare `pnpm test` default) skips the mid +
      // slow lane globs (heavy/isolated suites) for a quick local loop. Inert
      // under coverage and for an unset lane, so --all + cover + CI still run
      // every suite (see readVitestLanes). `--lane mid|slow` scopes via the
      // include above instead, so no exclusion is applied for them here.
      ...(laneFilterActive && activeLane === 'fast'
        ? [...midLaneGlobs, ...slowLaneGlobs]
        : []),
    ],
    // Some repos in the fleet (scaffolding-only, hook-only, etc.) ship
    // this config but don't yet have a `test/` directory — vitest's
    // default behavior would fail "no tests found" there. Repos that
    // do have tests still error on actual test failures; this flag
    // only affects the empty-suite case.
    passWithNoTests: true,
    // Reporters left unset so vitest applies its own default:
    // `[isAgent ? 'minimal' : 'default', ...(GITHUB_ACTIONS ? ['github-actions'] : [])]`
    // (vitest/src/defaults.ts). That yields the token-lean `minimal` reporter
    // inside an AI coding agent (std-env `isAgent`: CLAUDECODE/CURSOR_/…),
    // `default` for humans, and the `github-actions` annotations reporter in CI.
    // Hard-coding `reporters: ['default']` would override that default and
    // defeat all three. https://vitest.dev/guide/reporters
    pool: resolvePool(),
    // Vitest 4 removed `poolOptions`; the per-pool worker knobs are now
    // top-level. `maxThreads`/`maxForks` → `maxWorkers`; `singleThread`/
    // `singleFork` → `fileParallelism: false` (forces maxWorkers to 1);
    // `minThreads` and `useAtomics` were dropped with no replacement.
    // Worker count tuned to physical CPUs: GH Actions ubuntu-latest has
    // 4 cores, dev laptops typically 8-16. `getCI()` (rewire-aware
    // presence check on `CI`) is truthy even for CI="" or CI=0, matching
    // the fleet convention that any CI value means CI.
    //
    // Isolation: true by default (correctness — no cross-file state leak). A
    // repo lists safe-to-share globs in .config/repo/vitest-non-isolated.json;
    // when present, this default project EXCLUDES them (the second project runs
    // them non-isolated). When absent, every file is isolated.
    isolate: true,
    ...(nonIsolatedGlobs.length
      ? {
          projects: [
            {
              extends: true,
              test: {
                name: 'isolated',
                isolate: true,
                exclude: nonIsolatedGlobs,
              },
            },
            {
              extends: true,
              test: {
                name: 'non-isolated',
                isolate: false,
                include: nonIsolatedGlobs,
              },
            },
          ],
        }
      : {}),
    // Keep coverage file-parallel. Worker setup removes the already-consumed
    // COVERAGE flag before test code runs, so a nested Vitest child cannot turn
    // coverage back on and clean the outer run's shared .tmp reports. Ordinary
    // Node children still inherit NODE_V8_COVERAGE for subprocess merging.
    // Local coverage caps at 8 workers because this spawn-heavy suite saturates
    // there; 16 workers add filesystem/process contention. Ordinary local tests
    // retain 16 workers, while CI matches its 4 available cores.
    maxWorkers: resolveMaxWorkers(),
    // Coverage runs with V8 instrumentation that spawned children inherit, so
    // spawn-heavy tests (hook integration specs launch a node child per case)
    // legitimately exceed 10s there. CI gets a 60s budget unconditionally:
    // 2-core runners × parallel workers starve spawn-per-case suites
    // (RuleTester spawns one oxlint child per case) — the 10s/30s ceilings
    // killed lint-rule suites mid-queue on every OS while the same files pass
    // locally.
    testTimeout: getCI() ? 60_000 : isCoverageEnabled ? 30_000 : 10_000,
    hookTimeout: getCI() ? 60_000 : isCoverageEnabled ? 30_000 : 10_000,
    bail: getCI() ? 1 : 0,
    // Coverage shape comes from the fleet base merged with the repo-owned
    // `.config/repo/coverage.json` overlay (include replace, exclude
    // add/remove) — one canonical exclude list instead of a drifted copy here.
    coverage: {
      enabled: isCoverageEnabled,
      ...resolveCoverageConfig(),
    },
  },
})
