# golden-fixture-naming-guard

PreToolUse guard. Blocks a Write / Edit / MultiEdit that **creates** a new
`*.expected.json` test fixture, pointing at the `*.golden.json` name instead.

## Why

A committed test reference-output fixture is the on-disk oracle a test diffs its
`actual` result against. `expected` is already the assertion argument
(`expect(actual).toEqual(expected)`), so `*.expected.json` overloads one word for
both the file and the operand. `golden` is the established
authority-verified-output term (Go's `testdata/*.golden`). Full rationale +
migration steps: [`golden-fixtures`](../../../../docs/agents.md/fleet/golden-fixtures.md).

## Scope

- Fires only on **creation** of a `*.expected.json` name — editing one that
  already exists on disk — a pre-rule fixture, or a rename in progress — is never
  blocked.
- Fleet-only (`isFleetTarget`): an external / sibling clone owns its own naming.
- Belt scan: `scripts/fleet/check/golden-fixtures-are-named-golden.mts` fails
  when a tracked `*.expected.json` survives anywhere in the repo.

## Bypass

`Allow golden-fixture-naming bypass` — rare; e.g. a third-party tool that
hard-codes the `.expected.json` filename.
