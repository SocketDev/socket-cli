---
name: fleet-running-test262
description: Run the test262 conformance suite against fleet parsers / runtimes (ultrathink acorn variants, socket-btm temporal-infra, future ports) using each repo's canonical runner. Never write homebrew test262 runners. Every parser/runtime in the fleet ships a runner under `test/scripts/test262-*.mts` and an unsupported-features config. Use this skill when asked to run spec tests, check conformance, debug a failing test262 case, or compare a parser against a reference implementation.
user-invocable: true
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(ls:*), Bash(cat:*), Bash(grep:*), Bash(find:*), Read
model: claude-haiku-4-5
context: fork
---

# running-test262

The fleet has multiple parsers + runtimes that conform to ECMA262 or to a TC39 proposal:

- `ultrathink/packages/acorn/`: the JS parser, multiple lang ports (cpp/go/rust/typescript).
- `ultrathink/packages/test262-parser-runner/`: the canonical shared runner package.
- `socket-btm/packages/temporal-infra/`: Temporal-proposal C++ port.

Every one of them ships its own `scripts/test262-*.mts` runner + an `unsupported-features` config. Running test262 by hand (downloading the suite, scanning the metadata blocks, running each test) is the wrong shape. The runners already encode the suite-traversal, the per-feature skip logic, the harness setup, and the result-aggregation. Always reach for the existing runner.

## Test262 submodule pin

The fleet pins to a shared `tc39/test262` SHA. As of 2026-05-21 both ultrathink + socket-btm pin `7e115f46a`. When bumping in one repo, bump in the other so cross-fleet comparison stays apples-to-apples.

Annotation lives in each repo's `.gitmodules` with the pattern `# test262-YYYY.MM.DD` (commit-date of the pinned SHA, enforced by the `gitmodules-comment-guard` hook).

## 🚨 Strict allowlist policy

**An allowlist entry is ONLY for non-parser test fails.** Anything a parser should handle MUST NOT be allowlisted; it must be fixed in the parser. This is strict; the runners enforce it via design choices below.

What counts as "non-parser":

- **Unimplemented TC39 feature**: the proposal is at Stage 3+ but we haven't ported the grammar yet (decorators, source-phase imports). Goes in `test262-config/test262.unsupported-features` keyed on the TC39 feature name (NOT a test path).
- **Runner / harness bug**: the test runner itself produces a false signal (e.g. async-throws semantics, error-name matching). Fix the runner, don't allow-list the symptom.
- **Runtime-only test**: the test exercises a runtime API (`Reflect.*`, `Temporal.*`) that the parser-conformance run can't evaluate. The runners skip these by classification, not per-path allowlist.

What does NOT count and must be fixed in the parser:

- "Parser rejects valid input." Fix the parser.
- "Parser accepts invalid input." Fix the parser.
- "Parser produces wrong AST shape." Fix the parser.
- "Cross-impl divergence: Rust + TS pass, Go fails." Fix Go.

If you feel tempted to add a per-test-path allowlist entry, the answer is almost always "the parser needs fixing." The `unsupported-features` file is the only escape valve and it's feature-name-keyed by design. You can't sneak a parser bug past it.

## Canonical runners per repo

| Repo                                          | Runner                                     | Skip config                                                                                                            |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| ultrathink/packages/acorn (multi-lane driver) | `test/test262-compare.mts`                 | per-lane runner config (inherits unsupported-features)                                                                 |
| ultrathink/packages/acorn (per-lane)          | `lang/<lane>/scripts/test262.mts`          | `test262-config/test262.unsupported-features` (feature-name-keyed)                                                     |
| ultrathink/packages/test262-parser-runner     | `bin/test262-parser-runner.mts`            | passed via flags                                                                                                       |
| socket-btm/packages/temporal-infra            | `test/scripts/test262-temporal-runner.mts` | `test262-config/test262.allowlist` (Temporal-only path allowlist; reviewed manually for non-parser-fail justification) |

## Invocation patterns

### Multi-lane (recommended for cross-lane parity checks)

```bash
cd packages/acorn

# All 4 lanes, full suite
node test/test262-compare.mts

# Subset of lanes
node test/test262-compare.mts --lane rust,go

# All lanes, filtered to a single category
node test/test262-compare.mts --include 'language/expressions/await'

# Single test path, all lanes
node test/test262-compare.mts test/language/statements/class/private-method.js
```

Lanes: `rust`, `go`, `cpp`, `typescript`. Flags forward to each per-lane runner.

### Single-lane

```bash
# Per-lane direct invocation
cd packages/acorn/lang/rust && node scripts/test262.mts
cd packages/acorn/lang/go && node scripts/test262.mts
cd packages/acorn/lang/cpp && node scripts/test262.mts
cd packages/acorn/lang/typescript && node scripts/test262.mts

# socket-btm temporal-infra
cd socket-btm/packages/temporal-infra && node test/scripts/test262-temporal-runner.mts
```

### Single-case debug

Pass the test path positionally:

```bash
# Single lane
node scripts/test262.mts test/language/expressions/await/await-in-nested-function.js

# All lanes
node test/test262-compare.mts test/language/expressions/await/await-in-nested-function.js
```

### Targeted filtering

```bash
node scripts/test262.mts --include 'export'          # regex on path
node scripts/test262.mts --exclude 'surrogate'       # regex on path
node scripts/test262.mts --category module           # named feature group
node scripts/test262.mts --include 'class' --exclude 'async'
```

### Vitest-integrated mode

Each repo also wires a vitest test that wraps the runner. Useful for CI integration and selective re-runs:

```bash
pnpm exec vitest run test/unit/test262.test.mts             # ultrathink acorn
pnpm exec vitest run test/unit/test262-temporal.test.mts    # socket-btm temporal
```

## Common failure modes

- **Submodule missing.** The test262 suite is a git submodule. If the runner errors with "test262 suite not found", run `git submodule update --init --recursive`.
- **Feature classification drift.** The runner uses each test's metadata block (`/*--- features: [...] ---*/`) to decide whether to run or skip. If a new TC39 feature is added upstream, classify it in the `unsupported-features` config first; do not let the runner silently pass tests for features the parser doesn't implement.
- **"Allowlist drift": does NOT apply here.** The acorn lanes don't carry a per-test-path allowlist. If a test starts passing or failing, that's the parser's behavior; either the parser is correct and the test is correct (good), or one of them is wrong and that's a bug.
- **Cross-fleet drift.** ultrathink and socket-btm should pin the same `tc39/test262` SHA. If you're investigating a flaky test, double-check both `.gitmodules` files first.

## Never write a homebrew runner

The existing runners encode dozens of edge cases (strict-mode harness wrapping, async-throws semantics, error-name matching, the `negative.phase` distinction between parse vs early errors). Recreating that surface from scratch reliably misses cases. If you find yourself wanting to "just run a few test262 files by hand," reach for the runner with a filter arg instead.

## Reference

- TC39 test262 spec: https://github.com/tc39/test262
- Each runner's source is the source of truth for invocation flags and exit-code conventions; cat the runner first if the invocation is unclear.
- Strict allowlist policy + multi-lane behavior + `tc39/test262` pin date all encoded in this skill. Read this skill before touching either system.
