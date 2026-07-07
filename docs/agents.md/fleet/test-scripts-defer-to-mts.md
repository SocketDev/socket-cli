# Test scripts defer to a .mts wrapper

A `package.json` `test`/`test:*` script never invokes a test-runner binary
directly. It calls a `.mts` wrapper (`node <path>.mts`) that owns the runner
invocation, scope detection, and `--config` resolution. The hook / lint-rule /
git-hook tier is the one sanctioned exception: its canonical form IS
`node --test test/*.test.mts` (see `test-layout.md`).

## The rule

- **Root / single-package repos**: `"test": "node scripts/fleet/test.mts"`.
  The wrapper resolves `--config`, the scope mode (`--staged`/`--changed`/
  `--all`/explicit files), and the pre-commit single-worker setting. A bare
  `vitest run` in the script value bypasses all three.
- **Monorepo packages**: no per-package script needed. `scripts/fleet/test.mts`
  spawns ONE vitest process from the repo root whose `.config/repo/vitest.config.mts`
  `include` is double-star-anchored (`**/test/**/*.test.{...}`, not the
  root-only `test/**/*.test.{...}`), so it already discovers a nested
  `packages/<name>/test/**` tree. A package whose tests need their own vitest
  config or env wrapper (not the fleet-wide one) still routes through a thin
  `.mts` wrapper, never a raw runner call.
- **Hook / lint-rule / git-hook tier is exempt.** Its own package.json
  legitimately reads `"test": "node --test test/*.test.mts"`. That IS the
  `.mts`-routed form for that tier (CLAUDE.md "Tests are vitest via…", and
  `test-layout.md`), not a violation.
- **`test:unit`, `test:integration`, and any other `test:*` key** follow the
  same rule as bare `test`. The KEY name doesn't change the requirement.

## Why

Every repo's test invocation needs to agree on `--config`, on which files a
scope resolves to, and on the pre-commit worker count. That logic lives
exactly once, in the wrapper. A raw `vitest run` (or `jest`/`mocha`/`ava`/`tap`)
in a package.json script re-derives that logic per package, and it drifts.
A bare runner invocation with zero matching test files silently reports a
green pass (`exit 0`, "No test files found"); a build-infra package's raw
`vitest run` with no test target once blocked every commit on an unrelated,
unfixable "no tests" failure instead. Both are the same footgun, from
opposite directions. Routing every script through the wrapper means the
scope/config/worker-count fix lands once, and every package inherits it.

## Migration backlog

This rule ships with a report-only check
(`scripts/fleet/check/test-scripts-are-deferred.mts`) rather than a hard
`check --all` gate: some fleet repos still carry raw-runner test scripts that
predate this rule. Run the check locally (`node
scripts/fleet/check/test-scripts-are-deferred.mts --strict`) to see a repo's
own backlog, migrate the flagged script(s) to the wrapper form, and re-run.
Once a repo's backlog clears, its own `check.mts` step can pass `--strict`.

## Enforcement

- `scripts/fleet/check/test-scripts-are-deferred.mts` — fleet-wide scan of
  every `package.json`'s `test*` scripts; report-only by default, `--strict`
  fails on any raw-runner script outside the hook/lint-rule tier.
- `.claude/hooks/fleet/test-script-defers-guard/` — PreToolUse edit-time twin:
  blocks introducing a NEW raw-runner test script in a package.json.
