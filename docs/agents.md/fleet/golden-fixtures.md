# Golden fixtures

A **golden fixture** is a committed reference output: the on-disk oracle a test
diffs its `actual` result against. The fleet names these `*.golden.json` (or
`*.golden.<ext>`), never `*.expected.json`.

## Why `golden`, not `expected`

- **`expected` collides with the assertion vocabulary.** Every runner writes
  `expect(actual).toEqual(expected)` / `assert.deepEqual(actual, expected)`, so
  `expected` is already the in-code argument name. Naming the on-disk file
  `*.expected.json` overloads one word for two different things (the file and the
  assertion operand), and a reader can't tell which you mean.
- **`golden` is the established term** for authority-verified reference output.
  Go's `testdata/*.golden` + `-update` convention is the canonical example. It
  carries the right connotation: a trusted answer key, often generated from an
  external reference implementation, that the code under test must reproduce.
- **`snapshot` is the wrong connotation.** A snapshot (Jest/Vitest
  `__snapshots__/`) is self-captured from your own output. A golden is verified
  against an authority. When the fixture comes from a spec reference or a
  reference parser (not your own parser), it is a golden, not a snapshot.

## The rule

- A committed reference-output fixture is `*.golden.json`. A generator that mints
  it from a reference implementation writes `<name>.golden.json`; the test loads
  that path and compares structurally.
- Do not name it `*.expected.json`. The guard blocks writing one; the check
  belt-scans the tree for stragglers.
- An error-expectation fixture — a fixture that must be rejected — keeps the same
  stem: `<name>.golden.json` carrying `{ "error": "…" }`, or
  `<name>.error.golden.json`.

## Enforcement

- `golden-fixture-naming-guard` (PreToolUse) blocks a Write / Edit / MultiEdit
  that creates or renames a file to `*.expected.json`, pointing at the
  `*.golden.json` form. Bypass (rare, e.g. a third-party tool that hard-codes the
  `.expected.json` name): `Allow golden-fixture-naming bypass`.
- `scripts/fleet/check/golden-fixtures-are-named-golden.mts` is the belt scan: it
  fails when a tracked `*.expected.json` exists anywhere in the repo, naming each
  straggler and its `*.golden.json` target.

## Migration

Renaming an existing `*.expected.json` corpus is two moves in one commit: rename
the files, and update the loader that reads them (the test/runner that resolved
`.expected.json` now resolves `.golden.json`). A rename without the loader edit
leaves the suite green but unread, so verify the runner still finds the fixtures.
