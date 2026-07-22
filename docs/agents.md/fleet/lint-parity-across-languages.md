# Lint parity across languages

The fleet's `socket/*` lint doctrine is not js/ts-only — it holds for Rust, Go,
and C++ source too, via a **hybrid** mechanism: each native linter carries what
it can express, and one shared fleet check carries the language-agnostic rules no
native linter has.

## The two halves

- **Native baselines** (cascaded per repo `capability`): `clippy.toml` (cargo),
  `.golangci.yml` (go), `.clang-tidy` (cpp). These encode the rules the native
  linter *can* express — e.g. boolean-trap params (clippy `max-fn-params-bools`,
  revive `flag-parameter`), no-chdir/no-cwd (clippy `disallowed-methods`,
  forbidigo `os.Chdir`), prefer-logger (forbidigo `fmt.Print*`).
- **Shared cross-language check** — `scripts/fleet/check/native-sources-are-doctrine-clean.mts`
  scans `.rs`/`.go`/`.c*`/`.h*` for the doctrine no native linter expresses:
  `no-status-emoji`, `personal-path-placeholders`, `max-file-lines`. Conservative
  by design; runs clean on the wheelhouse.

## Coverage discipline

Never `coverage(off)` testable logic, and never rewrite an early-return into a
single-exit just to satisfy a coverage brace-region — chase the behavior, not the
tool's artifacts.

## Rollout

A Rust/Go/C++ repo activates its native baseline by declaring the capability in
`.config/repo/socket-wheelhouse.json` (`{ "claude": { "capabilities": { "go": ["."] } } }`);
only then does the cascade install that repo's `.golangci.yml` / `.clang-tidy` /
`clippy.toml`. Roll out per-repo via the cascade wave — never blanket-enable.

Full doctrine + the canonical Rust `[lints]` snippet:
`.claude/rules/fleet/lint-parity-across-languages.md`.
