# no-private-path-in-source-guard

`PreToolUse(Edit|Write|MultiEdit)` hook. Blocks a source-file edit that introduces an INTERNAL / PRIVATE path reference inside a **comment**.

The incident that motivated it: an agent leaked a scaffolding-repo `.claude/plans/<doc>.md` path into a public napi-rs source file's comment (`crates/.../src/lib.rs`). That single line discloses internal fleet repo layout, an operator-local working-notes location, and a dev-box checkout path to anyone reading the shipped source.

## What it flags

Inside comment syntax only (string literals and real code are ignored):

1. **`.claude/plans/…` / `.claude/reports/…`** — untracked operator-local working notes (plans + reports never ship).
2. **`socket-<repo>/.claude/…`** — another fleet repo's private `.claude/` tree (cross-repo internal layout).
3. **`/Users/<name>/…`** — an absolute home path (leaks the username and on-disk layout).
4. **`../socket-<repo>/…`** — a sibling fleet-repo relative path (presumes a dev-box parent dir).

## File scope

Source-code files only: `.{c,m,}{j,t}sx?`, `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.c`, `.h`, `.rs`, `.go`, `.py`, `.rb`, `.java`, `.kt`, `.swift`, `.sh`, `.bash`, `.zsh`.

Markdown, docs, JSON/YAML, and the `.claude/` tree itself are **out of scope** — those surfaces reference these paths legitimately (a plan doc names a plan path; a report links a report). JS/TS comments are parsed via the shared acorn walker; other languages use a lexical line/block-comment scan.

## Bypass

`Allow private-path-in-source bypass` typed verbatim in a recent message. Rare — the fix is to delete the path from the comment.

## Source of truth

The rule lives in [`CLAUDE.md`](../../../CLAUDE.md) (the public-surface-hygiene bullet) and [`docs/agents.md/fleet/public-surface-hygiene.md`](../../../docs/agents.md/fleet/public-surface-hygiene.md). The shared matcher is `_shared/private-paths.mts`; the same patterns are mirrored by the `socket/no-private-path-in-source` lint rule and the `scripts/fleet/check/private-paths-are-absent.mts` commit-time check.
