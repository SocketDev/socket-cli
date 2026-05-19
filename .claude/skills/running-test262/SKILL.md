---
name: running-test262
description: Run the test262 conformance suite against fleet parsers / runtimes (ultrathink acorn variants, socket-btm temporal-infra, future ports) using each repo's canonical runner. Never write homebrew test262 runners — every parser/runtime in the fleet ships a runner under `test/scripts/test262-*.mts` and an allowlist / unsupported-features config. Use this skill when asked to run spec tests, check conformance, debug a failing test262 case, or compare a parser against a reference implementation.
user-invocable: true
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(ls:*), Bash(cat:*), Bash(grep:*), Bash(find:*), Read
---

# running-test262

The fleet has multiple parsers + runtimes that conform to ECMA262 or to a TC39 proposal:

- `ultrathink/packages/acorn/` — the JS parser, multiple lang ports (cpp/go/rust/wasm).
- `ultrathink/packages/test262-parser-runner/` — the canonical runner package.
- `socket-btm/packages/temporal-infra/` — Temporal-proposal C++ port.
- (Future) `@ultrathink/acorn` standalone package once it ships.

Every one of them ships its own `scripts/test262-*.mts` runner + an allowlist or `unsupported-features` config. Running test262 by hand (downloading the suite, scanning the metadata blocks, running each test) is the wrong shape — the runners already encode the suite-traversal, the per-feature skip logic, the harness setup, and the result-aggregation. Always reach for the existing runner.

## When to use

- "Run the spec tests" / "check test262 conformance" / "are we passing the suite?"
- "This failing test262 case keeps tripping the parser — help debug."
- "Compare this parser against the reference implementation on test262."
- Asked to add a runner for a new language port — use the existing runners as the template; never start fresh.

## Canonical runners per repo

| Repo                                          | Runner                                     | Allowlist / config                            |
| --------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| ultrathink/packages/acorn (TS/wasm)           | `test/scripts/test262-runner.mts`          | `test262-config/test262.unsupported-features` |
| ultrathink/packages/acorn (cpp/go/rust ports) | `lang/<lang>/scripts/test262.mjs`          | per-lang config                               |
| ultrathink/packages/test262-parser-runner     | `bin/test262-parser-runner.mts`            | passed via flags                              |
| socket-btm/packages/temporal-infra            | `test/scripts/test262-temporal-runner.mts` | `test262-config/test262.allowlist`            |

## Invocation patterns

### Full run

```bash
# ultrathink acorn (TS)
cd packages/acorn && node test/scripts/test262-runner.mts

# socket-btm temporal-infra
cd packages/temporal-infra && node test/scripts/test262-temporal-runner.mts

# acorn lang ports
cd packages/acorn/lang/cpp && node scripts/test262.mjs
cd packages/acorn/lang/go && node scripts/test262.mjs
cd packages/acorn/lang/rust && node scripts/test262.mjs
```

### Single-case debug

Pass the test path to the runner:

```bash
node test/scripts/test262-runner.mts test/language/expressions/await/await-in-nested-function.js
```

The runner reports the AST diff, the harness state, and whether the test is in the allowlist / unsupported-features set.

### Vitest-integrated mode

Each repo also wires a vitest test that wraps the runner — useful for CI integration and selective re-runs:

```bash
pnpm exec vitest run test/unit/test262.test.mts             # ultrathink acorn
pnpm exec vitest run test/unit/test262-temporal.test.mts    # socket-btm temporal
```

## Common failure modes

- **Submodule missing.** The test262 suite is a git submodule. If the runner errors with "test262 suite not found", run `git submodule update --init --recursive`.
- **Feature classification drift.** The runner uses each test's metadata block (`/*--- features: [...] ---*/`) to decide whether to run or skip. If a new TC39 feature is added upstream, classify it in the `unsupported-features` config first; do not let the runner silently pass tests for features the parser doesn't implement.
- **Allowlist drift.** When a test starts passing that was previously failing, the allowlist still includes it — clean it up by removing from the allowlist so the suite gates on the new behavior.

## Never write a homebrew runner

The existing runners encode dozens of edge cases (strict-mode harness wrapping, async-throws semantics, error-name matching, the `negative.phase` distinction between parse vs early errors). Recreating that surface from scratch reliably misses cases. If you find yourself wanting to "just run a few test262 files by hand," reach for the runner with a filter arg instead.

## Reference

- TC39 test262 spec: https://github.com/tc39/test262
- Each runner's source is the source of truth for invocation flags and exit-code conventions; cat the runner first if the invocation is unclear.
