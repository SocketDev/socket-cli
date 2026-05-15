# pointer-comment-guard

PreToolUse hook (informational; never blocks) that flags pointer-style comments missing the one-line claim that should accompany them.

## Why

Per CLAUDE.md's "Code style → Pointer comments" rule:

> Pointer comments are acceptable when (a) the destination actually carries the load-bearing explanation, AND (b) the inline form carries the one-line claim so a reader who never follows the pointer still walks away with the *why*. A pointer with neither is dead weight; a pointer with only (a) fails CLAUDE.md's "the reader should fix the problem from the comment alone" test.

This hook verifies (b) syntactically. (a) requires following the pointer and assessing destination quality, which a static check can't do.

## What it catches

A comment that opens with a pointer phrase — `see X` / `see X for details` / `full rationale in Y` / `documented in Z` / `defined in W` / `described in V` / `specified in U` / `reference in T` — and contains no detectable claim shape in the rest of the comment.

**Flagged:**

```ts
// See the @fileoverview JSDoc above.

// Full rationale in the fileoverview.

// See X for details.
```

**Accepted:**

```ts
// Why uncurried, not Fast-API'd: see the fileoverview JSDoc above.
// V8's existing hot path beats trampoline overhead.

// Searches stay uncurried — V8's hot path beats any Fast API
// binding here. Full rationale in the @fileoverview JSDoc above.
```

## Scope

- Source-file extensions only: `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, `.tsx`, `.jsx`.
- Skips `test/` directories and `*.test.*` files — illustrative pointer-only comments are common there and not the failure mode this hook targets.

## Behavior

- Exit code 0 in all cases. Hook writes a stderr breadcrumb when a violation is detected; the next turn sees it and can fix.
- Markdown, configs, and anything outside the source-file extensions are skipped.

## Bypass

- Type `Allow pointer-comment bypass` in a recent user message (also accepts `Allow pointer comment bypass` / `Allow pointercomment bypass`), or
- Set `SOCKET_POINTER_COMMENT_GUARD_DISABLED=1`.

## Test

```sh
pnpm test
```
