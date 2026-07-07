# no-test-in-scripts-guard

PreToolUse(Edit/Write/MultiEdit) hook that blocks creating a `*.test.*` file
anywhere under `scripts/`.

## What it catches

An Edit/Write whose `file_path` matches `scripts/**/*.test.*` — e.g.
`scripts/fleet/test/foo.test.mts`, `scripts/repo/sync-scaffolding/test/bar.test.mts`.

Tests live under `test/` (`test/unit/`, `test/isolated/`, …). `scripts/` is for
scripts. A test under `scripts/**` is invisible to the vitest runner — the fleet
`.config/repo/vitest.config.mts` excludes `scripts/**/test/**` and nothing else
runs it — so it silently never executes. That's worse than no test: it looks
green while proving nothing.

Reusable test helpers belong in `test/_shared/fleet/lib/`, not a
`scripts/**/test/helpers.mts`.

## What it allows

- `*.test.*` under `test/**` — the canonical home.
- The co-located test homes that own their own runners and are NOT under
  `scripts/`: `.config/fleet/oxlint-plugin/fleet/<id>/test/`, `.claude/hooks/**/test/`,
  `.git-hooks/**/test/`.
- Non-test files under `scripts/` — only `*.test.*` paths are blocked.

## Why

2026-06-04: the wheelhouse had 11 `scripts/fleet/test/` + 22
`scripts/repo/sync-scaffolding/test/` node:test suites that never ran in CI —
the cascade engine's own tests were dead. Moving them to `test/unit/` (vitest)
surfaced a real regression (a `lock-step-refs-resolve` regex gone all-non-capturing
so every reference resolved as `undefined`). This guard stops the pattern
recurring at edit time.

## Bypass

Type `Allow test-in-scripts bypass` in a recent user turn.

## Exit codes

- `0` — pass (not a test under scripts/, or bypass present).
- `2` — block.

Fails open on any throw.
