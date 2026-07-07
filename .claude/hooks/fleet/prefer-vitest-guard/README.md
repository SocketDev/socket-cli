# prefer-vitest-guard

PreToolUse hook that blocks `node --test <file>` Bash commands and steers to the fleet-canonical test runner.

## What it catches

`node --test` runs the Node.js built-in test runner. Fleet repos use **vitest**. The two runners are incompatible — test files register with vitest globals, not `node:test`'s API, so `node --test` produces silent passes or "No test suite found" failures.

## What it suggests

```sh
# Run a specific test file (preferred — scoped to your change):
pnpm exec vitest run path/to/your.test.mts

# Run the full suite:
pnpm test
```

Targeting a specific file is always preferred over the full suite — faster feedback, less noise.

## What it allows

`node --test` is the correct runner for every tier the fleet vitest config **excludes** from discovery — the allow-set is the exact complement of vitest's `include`, kept in lock-step with `.config/repo/vitest.config.mts`'s `exclude`:

- `.claude/hooks/**/test/**` — hook tests (run via `pnpm run test:hooks`).
- `.config/fleet/oxlint-plugin/**/test/**` — `socket/*` lint-rule tests.
- `scripts/**/test/**` — script-suite tests.
- `.git-hooks/**` — git-hook tests.
- repo-tunable globs from the `nodeTestExclude` key of `.config/{fleet,repo}/vitest.json` (the same key vitest merges into `exclude`, so the two never drift).

A `node --test` whose targets all resolve under these tiers passes. Mixing one of these with a src/repo test still blocks.

## Bypass

Type `Allow node-test-runner bypass` verbatim in a recent user turn.
