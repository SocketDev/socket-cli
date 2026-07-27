# generic-export-name-nudge

PostToolUse `Edit`/`Write`/`MultiEdit` hook that nudges (never blocks) when an
edit ADDS an exported declaration whose name is a single generic token —
`export function create`, `export const parse`, `export type Result`.

The edit-time partner of the `socket/exported-name-has-domain-word` oxlint
rule. Both share ONE predicate — `isGenericExportName` in
[`.config/fleet/oxlint-plugin/lib/generic-name-tokens.mts`](../../../../.config/fleet/oxlint-plugin/lib/generic-name-tokens.mts) —
so the denylist and the sanctioned-convention exemptions (`check`, `main`,
`run`, …) never drift between the nudge and the lint gate. See
[`docs/agents.md/fleet/code-style.md`](../../../../docs/agents.md/fleet/code-style.md).

## What it flags

An `Edit`/`Write`/`MultiEdit` to a `.mts`/`.ts` file under `src/`, `scripts/`,
or `.claude/hooks/` whose ADDED content (Write's full content, or Edit's
`new_string`) declares an export — `function`/`const`/`let`/`class`/`type`/
`interface`/`enum` — whose name is a single word on the generic-token
denylist (`create`, `parse`, `get`, `handle`, …).

## Why

Coding agents navigate by grep at ~10 tokens per line. A bare one-word export
is a grep-noise magnet: a real audit found `create` matched 1585 times across
459 files versus `createStripeClient` 43 times across 19 — one-word names are
~61% unique, three-word ~96%. Qualifying the name with a domain word
(`create` → `createStripeClient`) makes the symbol findable without reading
unrelated files.

## What it does NOT flag

- A generated/vendored/build path (`node_modules/`, `dist/`, `build/`,
  `coverage/`, `_dist/`, `vendor/`, `upstream/`, `third_party/`) or a `.d.ts`/
  `.d.mts` declaration file.
- A file outside `src/`, `scripts/`, or `.claude/hooks/` — a test file under
  `test/`/`tests/`/`__tests__/` is out of scope.
- A multi-word export (`createStripeClient`) or a single non-generic word
  (`enrich`, `sanitize`).
- A sanctioned structural-convention name (`check`, `main`, `run`, `handler`,
  `activate`, `deactivate`, `register`, `setup`, `teardown`, `index`) — the
  shared predicate exempts these.
- A local (non-exported) helper's name — the author's business, not a
  fleet-wide search surface.
- A bare re-export (`export { create }`) — the name is flagged at its
  definition site, same scope as the oxlint rule.

## Trigger

Fires on `Edit` / `MultiEdit` / `Write` PostToolUse events. Always exits 0;
the reminder is informational on stderr.

## Bypass

No bypass phrase — this hook never blocks.

## Companion files

- `index.mts` — the hook; `genericExportNamesAdded(content)` is the pure
  exported detector.
- `test/repo/integration/hooks/generic-export-name-nudge.test.mts` — vitest
  integration tests (spawn-based, never self-import).
