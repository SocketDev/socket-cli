# lock-step-ref-guard

PreToolUse hook (informational; never blocks) that flags malformed and stale `Lock-step` comments at the moment they land in a file.

## Why

Per CLAUDE.md's _Code style → Cross-port files_ rule, files that ship in multiple language implementations use a `Lock-step` comment convention to cross-reference the canonical impl. The full forms live in [`docs/claude.md/fleet/parser-comments.md`](../../../docs/claude.md/fleet/parser-comments.md) §5–6.

The CI gate (`scripts/fleet/check/lock-step-refs-resolve.mts`) catches stale `<path>` references at commit time, but two classes of bugs slip past it:

1. **Typos in the `Lock-step` shape itself** — `lockstep`, `Lock step`, `Lock-step Rust:` (missing `with`/`from`), `Lock-step with: <path>` (missing `<Lang>`). The CI regex doesn't match these, so they silently rot forever as illegitimate comments.
2. **Same-keystroke staleness** — a porter typing `// Lock-step with Rust: crates/parser-stmt/src/foo.rs` after `parser-stmt/` was renamed last week. The CI gate catches it at commit; the hook catches it at the keystroke so the porter sees the breadcrumb before committing.

## What it catches

**Malformed:**

```rust
// lockstep with Go: parser.go:42         // wrong: hyphen missing
// Lock step with Go: parser.go:42        // wrong: hyphen missing
// Lock-step Rust: src/foo.rs             // wrong: missing with/from
// Lock-step with: src/foo.rs             // wrong: missing <Lang>
// Lock-step with Go, parser.go           // wrong: comma instead of colon
```

**Stale (when `.config/lock-step-refs.json` is present):**

```rust
// Lock-step with Rust: crates/parser-stmt/src/foo.rs   // crate doesn't exist
//! Lock-step from Go: src/parser-old/class.go          // dir was renamed
```

**Accepted:**

```rust
//! Lock-step with Go: src/parser/class.go
//! Lock-step from Rust: crates/parser/src/class.rs
// Lock-step with Go: parser.go:6450-6457
// Lock-step note: reshaped for borrowck — Zig's `defer s.restore()` ...
```

## Scope

- Source-file extensions: `.rs`, `.go`, `.cpp`, `.hpp`, `.h`, `.ts`, `.mts`, `.cts`, `.tsx`, `.py`, `.zig`, `.js`, `.mjs`, `.cjs`, `.jsx`.
- Skips `test/` directories and `*.test.*` files — illustrative example refs are common in tests and don't represent real port-tracking claims.
- Stale-path checking is **opt-in per repo**: requires `.config/lock-step-refs.json` to declare `<Lang>` → impl-root mappings. Without the config, only malformed-shape detection runs.
- Malformed-shape detection always runs, regardless of opt-in. Typos are typos.

## Behavior

- Exit code 0 in all cases. Hook is informational; the next turn sees the stderr breadcrumb and can fix.
- The blocking layer is the CI gate `scripts/fleet/check/lock-step-refs-resolve.mts`, run by `pnpm check`.

## Bypass

- Type `Allow lock-step bypass` in a recent user message (also accepts `Allow lockstep bypass` / `Allow lock step bypass`).

## Test

```sh
pnpm test
```
