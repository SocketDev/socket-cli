/**
 * @file Vitest configuration. Isolation: the fleet default is `isolate: true` —
 *   each test file gets a fresh module registry + globals, so cross-file
 *   leakage (process.env, path-rewire overrides, vi.mock state, nock
 *   interceptors) is impossible. Correctness by default. A repo that wants the
 *   faster shared-worker mode for a known-safe subset opts those files OUT by
 *   listing globs in the `vitest.nonIsolated` array of the settings file,
 *   `.config/repo/socket-wheelhouse.json`. When set, those globs run in a
 *   second, non-isolated project and the default isolated project excludes
 *   them. No globs → everything isolated.
 */
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { envAsBoolean } from '@socketsecurity/lib-stable/env/boolean'
import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { defineConfig } from 'vitest/config'

import { GENERATED_GLOBS } from '../../scripts/fleet/constants/generated-globs.mts'
import { resolveCoverageConfig } from '../fleet/vitest.coverage.fleet.config.mts'
import {
  readConformanceExcludeGlobs,
  readNonIsolatedGlobs,
  readVitestLanes,
  readVitestSettings,
  repoNodeTestExcludeGlobs,
  stringArray,
} from './vitest.settings.mts'

// Pin TZ here, at config-eval time in the MAIN process, so every worker
// inherits TZ=UTC from its spawn env. This has to happen before a worker
// starts: under the default `threads` pool a worker cannot change its own
// timezone afterwards — V8 caches it at the first Date op — so a `test.env.TZ`
// entry or a setupFiles assignment LOOKS right and does nothing, because both
// run inside the worker. Measured: `main after set TZ=UTC` reads day 19 while
// `worker after self-set TZ=UTC` still reads day 18.
//
// Why it matters beyond flakiness: an unpinned TZ makes a date-formatting bug
// invisible to whoever wrote it and reproducible only for readers in another
// offset. socket-cli's analytics report labeled every row by LOCAL day while
// the API buckets by UTC day, so the same command emitted different dates
// west of UTC; its per-package config pinned TZ and hid the bug from the
// fleet runner. `??=` so an operator probing another zone can still override.
process.env['TZ'] ??= 'UTC'

// Coverage is on when the COVERAGE env is set (cover.mts) or the `--coverage`
// flag is passed. Match the FLAG, not any argv containing the substring
// "coverage" — a nested test run whose file-path args happen to include
// "coverage" must not silently turn coverage on and clean the shared
// coverage/.tmp (see test.mts resolveVitestEnv).
const isCoverageEnabled =
  envAsBoolean(process.env['COVERAGE']) ||
  process.argv.some(arg => arg.startsWith('--coverage'))

// Ceiling on the contention multiplier. A starved spawn is queued, not hung, so
// it deserves more time — but a genuinely WEDGED test must still fail in
// bounded time instead of hanging the run behind a growing budget.
const BUDGET_LOAD_CAP = 4

// Below this fraction of the core count the box counts as quiet and the base
// budget stands unchanged. Half the cores busy is normal for a test run.
const BUDGET_QUIET_LOAD_RATIO = 0.5

/**
 * How much to stretch a test budget for the machine's current contention.
 * `1` on a quiet box, rising toward {@link BUDGET_LOAD_CAP} as load climbs.
 *
 * A background build — a parallel `cargo build` saturating every core — starves
 * a spawn-per-case suite: the child is queued behind the compiler, so a fixed
 * ceiling turns machine load into a red suite with no code change. Observed:
 * one hook spec went from 1 failure to 5, 6, then 7 across three consecutive
 * runs as an unrelated `rustc` ramped to 779% CPU.
 *
 * Both readings are injectable so the arithmetic is testable without depending
 * on the load of whatever machine runs the suite.
 */
export function resolveBudgetLoadFactor(
  options?:
    | {
        cores?: number | undefined
        loadAvg?: number | undefined
        workers?: number | undefined
      }
    | undefined,
): number {
  const opts = { __proto__: null, ...options } as {
    cores?: number | undefined
    loadAvg?: number | undefined
    workers?: number | undefined
  }
  const cores = Math.max(1, opts.cores ?? os.availableParallelism())
  // loadavg() is [0, 0, 0] on win32, which yields the base budget — correct,
  // since there is no signal to scale by.
  const observed = Math.max(0, opts.loadAvg ?? os.loadavg()[0] ?? 0)
  // The reading is taken as the config loads, BEFORE the run creates its own
  // contention, so a quiet box reads quiet and the whole suite then runs at
  // maxWorkers. Treat the run's own parallelism as a floor on load: a spawn in
  // worker 7 competes with six siblings whatever the box looked like a second
  // ago. Without this floor a full-suite run measured 74s against a 60s budget
  // on a box that read 5.26 at startup.
  const workers = Math.max(0, opts.workers ?? resolveMaxWorkers())
  const effective = Math.max(observed, workers)
  const ratio = effective / (cores * BUDGET_QUIET_LOAD_RATIO)
  return Math.min(BUDGET_LOAD_CAP, Math.max(1, ratio))
}

/**
 * The per-test budget: the CI/coverage base ladder, stretched by current
 * machine contention. Used for both `testTimeout` and `hookTimeout` so a
 * starved `beforeAll` fixture gets the same headroom as the tests it feeds.
 */
export function resolveTestBudgetMs(
  options?:
    | {
        cores?: number | undefined
        loadAvg?: number | undefined
        workers?: number | undefined
      }
    | undefined,
): number {
  const ci = getCI()
  const base =
    ci && isCoverageEnabled
      ? 120_000
      : ci
        ? 60_000
        : isCoverageEnabled
          ? 30_000
          : 10_000
  return Math.round(base * resolveBudgetLoadFactor(options))
}

export function resolveFallbackMaxWorkers(): number {
  if (getCI()) {
    return 4
  }
  return isCoverageEnabled ? 8 : 16
}
export function resolveConfiguredMaxWorkers(): number | undefined {
  const configured = readVitestSettings().maxWorkers
  return typeof configured === 'number' && configured > 0
    ? configured
    : undefined
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
/**
 * Fast-fail bail count. A coverage run MUST execute the FULL suite to measure
 * it, so bail is INERT under coverage, like the lane filter: bailing on the
 * first failure aborts ~half the suite and its subprocess coverage, collapsing
 * the aggregate to a phantom partial (#79: CI read 36% vs the true ~73% because
 * one failing test bailed the run after 249 of 1224 files). Plain CI test jobs
 * no coverage, keep fast-fail bail=1; local (no CI) runs the whole suite.
 * Pure so the resolution is unit-testable without a real CI/coverage env.
 */
export function resolveBail(config: {
  readonly isCI: boolean
  readonly isCoverage: boolean
}): number {
  const cfg = { __proto__: null, ...config }
  return !cfg.isCoverage && cfg.isCI ? 1 : 0
}
/**
 * Resolve-alias merge. This config is CASCADED — a member repo that edited it
 * directly lost the edit on the next cascade: socket-webext's
 * `@socketsecurity/sdk` → browser-build alias was wiped exactly that way. The
 * settings file's `vitest.alias` map is the repo-owned surface that survives.
 * Two maps merge per key, the second winning, which is what lets a caller layer
 * a fleet default under a repo's own entries. Dot-relative replacements — `./`
 * or `../` — resolve against `root`, the repo root at config-load time, because
 * vite substitutes alias replacements verbatim: left relative, the result would
 * resolve against each importer instead of the repo root. Bare package names
 * and absolute paths pass through untouched.
 */
export function mergeVitestAlias(
  fleet: unknown,
  repo: unknown,
  root: string = process.cwd(),
): Record<string, string> {
  const entries = (tier: unknown): Array<[string, string]> =>
    tier && typeof tier === 'object' && !Array.isArray(tier)
      ? Object.entries(tier).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        )
      : []
  return Object.fromEntries(
    [...entries(fleet), ...entries(repo)].map(([find, replacement]) => [
      find,
      replacement.startsWith('./') || replacement.startsWith('../')
        ? path.resolve(root, replacement)
        : replacement,
    ]),
  )
}
export function resolveVitestAlias(): Record<string, string> {
  return mergeVitestAlias(undefined, readVitestSettings().alias)
}
export function resolvePool(): 'forks' | 'threads' {
  const chosen = readVitestSettings().pool
  return chosen === 'forks' || chosen === 'threads' ? chosen : 'threads'
}
// Vite's own server-side resolve conditions, mirrored as a literal because
// `vite` is a transitive dep here, not a direct one — importing
// `defaultServerConditions` from it would not typecheck, and `vitest/config`
// does not re-export it. Verified against the installed vite 8.1.5, whose
// DEFAULT_SERVER_CONDITIONS is exactly this list. drift-watch: re-verify on a
// vite major bump.
const VITE_DEFAULT_SERVER_CONDITIONS = [
  'module',
  'node',
  'development|production',
] as const

/**
 * Extra resolve conditions, from `vitest.conditions`. Vite REPLACES its default
 * condition list rather than appending to it, so the repo's entries are listed
 * FIRST and vite's own server defaults are appended — dropping them would break
 * plain node resolution for every dependency.
 */
export function resolveVitestConditions(): string[] {
  const configured = stringArray(readVitestSettings().conditions)
  return configured.length > 0
    ? [...configured, ...VITE_DEFAULT_SERVER_CONDITIONS]
    : []
}
const nonIsolatedGlobs = readNonIsolatedGlobs()
const repoResolveAlias = resolveVitestAlias()
const repoResolveConditions = resolveVitestConditions()

// Lane resolution. The runner sets FLEET_LANE (bare `pnpm test` → 'fast'); the
// filter is inert under coverage and for an unset lane, so --all / scoped /
// cover runs traverse every lane, nothing is cut from the gate.
const vitestLanes = readVitestLanes()
const slowLaneGlobs = vitestLanes.slow ?? []
const midLaneGlobs = vitestLanes.mid ?? []
const activeLane = process.env['FLEET_LANE']
const laneFilterActive =
  !isCoverageEnabled &&
  (activeLane === 'fast' || activeLane === 'mid' || activeLane === 'slow')
// A lane's dir globs → test-file include patterns (`--lane mid|slow` runs ONLY
// that lane; a trailing `/**` becomes `/**/*.test.{…}`).
export function laneToTestGlobs(globs: string[]): string[] {
  return globs.map(
    g => `${g.replace(/\/\*+$/, '')}/**/*.test.{js,ts,mjs,mts,cjs}`,
  )
}
// The conformance tier's dir globs, and whether THIS run is the explicit
// conformance run. Set by scripts/repo/test-conformance.mts, never by hand.
const conformanceGlobs = readConformanceExcludeGlobs()
const conformanceTier = process.env['FLEET_TEST_CONFORMANCE'] === '1'

export default defineConfig({
  // Repo-owned resolution from the settings file's `vitest.alias` +
  // `vitest.conditions` — see mergeVitestAlias and resolveVitestConditions.
  // Spread conditionally so a repo declaring neither keeps vite's own
  // resolution untouched.
  ...(Object.keys(repoResolveAlias).length || repoResolveConditions.length
    ? {
        resolve: {
          ...(Object.keys(repoResolveAlias).length
            ? { alias: repoResolveAlias }
            : {}),
          ...(repoResolveConditions.length
            ? { conditions: repoResolveConditions }
            : {}),
        },
      }
    : {}),
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
    // setup, nock fail-closed, env scrubbing, in fleet/, repo-specific setup in
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
    include: conformanceTier
      ? laneToTestGlobs(conformanceGlobs)
      : laneFilterActive && activeLane === 'mid'
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
      // The conformance tier is opt-in via `pnpm run test:conformance`. Every
      // other lane drops it: these wrappers each spawn a FULL external corpus
      // (Test262 is ~92k scenarios per implementation), which is minutes to
      // hours, not a unit suite. Lifted only for the explicit conformance run,
      // where the include above targets exactly these globs.
      ...(conformanceTier ? [] : conformanceGlobs),
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
      // settings file's `vitest.nodeTestExclude`. The same key feeds
      // prefer-vitest-guard's allowlist so the two never drift.
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
    // Zero discovered files is normal for a scoped run, but it is a FAILURE
    // for the conformance tier: that run exists to execute those globs, so
    // discovering none means the tier is misconfigured and a silent pass would
    // report the heavy suites green without running one of them.
    passWithNoTests: !conformanceTier,
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
    // repo lists safe-to-share globs in the `vitest.nonIsolated` array of
    // .config/repo/socket-wheelhouse.json; when set, this default project
    // EXCLUDES them (the second project runs them non-isolated). When unset,
    // every file is isolated.
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
    // spawn-heavy tests, hook integration specs launch a node child per case
    // legitimately exceed 10s there. CI gets a 60s budget unconditionally:
    // 2-core runners × parallel workers starve spawn-per-case suites
    // (RuleTester spawns one oxlint child per case) — the 10s/30s ceilings
    // killed lint-rule suites mid-queue on every OS while the same files pass
    // locally. CI *with* coverage is strictly heavier than either alone
    // (instrumentation + 4-core contention + thousands of instrumented child
    // spawns in one run), so it gets the longest budget — the plain-CI 60s
    // still timed out the spawn-per-case hook specs (npm-2fa-needs-pty-guard,
    // single-lander-guard) under peak release-cover contention, losing their
    // coverage and failing the gate while all four metrics were above
    // threshold. Complete the ladder rather than shave the threshold.
    testTimeout: resolveTestBudgetMs(),
    hookTimeout: resolveTestBudgetMs(),
    bail: resolveBail({
      isCI: getCI(),
      isCoverage: isCoverageEnabled,
    }),
    // Coverage shape comes from the fleet base merged with the repo-owned
    // `coverage` section of .config/repo/socket-wheelhouse.json (include
    // replace, exclude add/remove) — one canonical exclude list instead of a
    // drifted copy here.
    coverage: {
      enabled: isCoverageEnabled,
      ...resolveCoverageConfig(),
    },
  },
})
