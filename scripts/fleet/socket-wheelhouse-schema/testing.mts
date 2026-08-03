/*
 * @file Test-config blocks of the socket-wheelhouse config: the `cover` suite's
 *   per-repo overrides and the vitest tuning the canonical vitest config reads.
 */

import { Type } from '@sinclair/typebox'

import { COVER_RUNNERS } from '../cover/runner.mts'

// ---------------------------------------------------------------------------
// Cover block — the `cover` suite's per-repo overrides (was cover.json).
// ---------------------------------------------------------------------------

// Shared by `thresholds` and each entry of `perFileThresholds`, so the two can
// never drift into disagreeing about what a metric is.
const CoverThresholdsSchema = Type.Object(
  {
    statements: Type.Optional(Type.Number()),
    branches: Type.Optional(Type.Number()),
    functions: Type.Optional(Type.Number()),
    lines: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
)

export const CoverSchema = Type.Object(
  {
    suites: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object(
          {
            config: Type.Optional(
              Type.String({
                description:
                  'Explicit vitest config path override (repo-root-relative) for this suite; defaults to the repo-first resolution of the suite basename.',
              }),
            ),
            runExclude: Type.Optional(
              Type.Array(Type.String(), {
                description:
                  'Globs passed as `vitest --exclude` for this suite — skips running matching test files (e.g. a cross-package test that would pollute this repo’s coverage denominator).',
              }),
            ),
          },
          { additionalProperties: false },
        ),
        {
          description:
            'Per-suite cover overrides, keyed by suite name (unit, shared, isolated, …).',
        },
      ),
    ),
    thresholds: Type.Optional(
      Type.Object(
        {
          statements: Type.Optional(Type.Number()),
          branches: Type.Optional(Type.Number()),
          functions: Type.Optional(Type.Number()),
          lines: Type.Optional(Type.Number()),
        },
        {
          additionalProperties: false,
          description:
            'Per-metric coverage thresholds (percent) the cover suite enforces; an absent metric inherits the fleet default.',
        },
      ),
    ),
    perFileThresholds: Type.Optional(
      Type.Record(Type.String(), CoverThresholdsSchema, {
        description:
          'Per-file coverage thresholds (percent), keyed by repo-root-relative file path; a file listed here is held to these numbers instead of the repo-wide `thresholds`.',
      }),
    ),
    runner: Type.Optional(
      Type.Union(
        COVER_RUNNERS.map(id => Type.Literal(id)),
        {
          description:
            'Which test runner the cover suite drives. Set this to match the repo’s own `test` script — a repo whose tests run under bun but is left on the vitest default collects no coverage and reports a false green.',
        },
      ),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Coverage config the `cover` suite reads (folded in from the former .config/repo/cover.json): per-suite run overrides + per-metric thresholds. Absent = fleet defaults.',
  },
)

// ---------------------------------------------------------------------------
// Coverage block — the include/exclude overlay the canonical coverage config
// reads (was the standalone .config/repo/coverage.json).
// ---------------------------------------------------------------------------

export const CoverageSchema = Type.Object(
  {
    include: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Coverage include globs that REPLACE (not extend) the fleet-default `src/**` candidate set. The route for a repo whose instrumentable source lives elsewhere — a monorepo maps `packages/*/src/**/*.{ts,mts,cts}` (+ a `!packages/*/src/external/**` negation); the wheelhouse maps `scripts/**`. Absent = the fleet default stands.',
      }),
    ),
    exclude: Type.Optional(
      Type.Object(
        {
          add: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Globs appended to the fleet-default coverage excludes — repo-specific dirs to drop from the denominator.',
            }),
          ),
          remove: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Fleet-default exclude entries to filter OUT (exact string match). A monorepo removes `packages/**` so its package source becomes measurable; the wheelhouse removes `scripts/**` so its script source is measured.',
            }),
          ),
        },
        {
          additionalProperties: false,
          description:
            'Deltas against the fleet-default coverage excludes: `remove` filters base entries out, `add` appends new ones.',
        },
      ),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Coverage include/exclude overlay the canonical coverage config (.config/fleet/vitest.coverage.fleet.config.mts) reads (folded in from the former standalone .config/repo/coverage.json). `include` REPLACES the fleet default; `exclude.remove`/`exclude.add` filter/append base excludes. Absent = fleet defaults.',
  },
)

// ---------------------------------------------------------------------------
// Vitest block — test-suite tuning the canonical vitest config reads.
// ---------------------------------------------------------------------------

export const VitestSchema = Type.Object(
  {
    alias: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          'Module resolve aliases for the test transform, merged into the canonical vitest config. A KEY is a literal module specifier, never a glob — a monorepo maps one entry per package (`"@stuie/core": "./packages/core/src/index.ts"`). A dot-relative value resolves against the REPO ROOT, not the config file, so `./packages/...` reads the same from any tier config.',
      }),
    ),
    conditions: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Extra `resolve.conditions` for the test transform. This is the source-condition route for a monorepo whose package `exports` map carries a `"source"` condition: without it vitest resolves a workspace package to its built `dist`, so the instrumented `src` never runs and the repo reports 0% coverage. Vite REPLACES the default condition list rather than appending, so list `source` FIRST and rely on vite\'s built-in client/server condition fallback for the rest.',
      }),
    ),
    conformanceExclude: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Heavy external-suite / cross-impl conformance wrapper globs excluded from the DEFAULT (unit) + cover suites, keeping the unit pass inside the fleet under-a-minute budget. A repo setting this MUST pair it with an explicit `test:conformance` runner so the tier never silently drops.',
      }),
    ),
    lanes: Type.Optional(
      Type.Object(
        {
          mid: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Globs for the `mid` lane — isolated in-process suites (env-mutating / vi.mock / fs-heavy). Skipped by the bare `pnpm test` fast lane; run via `pnpm run test:mid`. Coverage + CI run every lane, so nothing is cut.',
            }),
          ),
          slow: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Globs for the `slow` lane — heavy suites (subprocess-per-case, e.g. hook integration specs). Skipped by the bare `pnpm test` fast lane; run via `pnpm run test:slow`. Coverage + CI run every lane, so nothing is cut.',
            }),
          ),
        },
        {
          description:
            "Test LANES: a SPEED category orthogonal to test TYPE (unit/integration/e2e). `fast` is the implicit complement of `mid`+`slow`. The runner's `--lane <fast|mid|slow>` flag selects one; bare `pnpm test` defaults to `fast`.",
        },
      ),
    ),
    legacyScriptTests: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Repo-relative paths of legacy script-style test files (self-executing scripts, not vitest suites) excluded from every vitest tier. Each file keeps running through its own runner; listing it here keeps the tier configs from picking it up.',
      }),
    ),
    maxWorkers: Type.Optional(
      Type.Number({
        minimum: 1,
        description:
          "Worker cap for the vitest pool. Unset lets vitest size the pool from the machine; set it when a repo's suites are memory-heavy enough that a full-width pool thrashes.",
      }),
    ),
    nodeTestExclude: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Globs of test files allowed to run on `node:test` instead of vitest. The prefer-vitest-guard hook reads THIS key as its allowlist, so the guard and the vitest exclude can never drift into disagreeing about which files are exempt.',
      }),
    ),
    nonIsolated: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Globs of suites that run WITHOUT per-file isolation. Faster, and safe only for suites that mutate no shared global state; a suite that mocks globals, chdirs, or writes process.env belongs in the `mid` lane instead.',
      }),
    ),
    pool: Type.Optional(
      Type.Union([Type.Literal('forks'), Type.Literal('threads')], {
        description:
          'Vitest pool implementation. `threads` (the fleet default) is faster; `forks` gives each file a real process, which a suite needing true process isolation — its own cwd, its own native addon state — requires.',
      }),
    ),
    unitBudgetMs: Type.Optional(
      Type.Number({
        minimum: 1000,
        description:
          'Wall-clock budget for the unit test suites under cover.mts, in milliseconds. Fleet default 60000 (under a minute). A suite exceeding the budget gets a loud report-only warning pointing at the slow/mid lanes (`vitest.lanes`); the gate ratchets to a hard failure once the fleet conforms.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Tuning for the canonical vitest config (.config/repo/vitest.config.mts).',
  },
)
