# no-description-aside-guard

PreToolUse hook that BLOCKS a write to a package manifest (`package.json` or
`Cargo.toml`) when the `description` field ends with a listy parenthetical
aside.

## Why

A manifest description reads best as a plain statement of what the package is. A
trailing `(a, b, c)` or `(x + y)` tail re-lists detail the sentence already
carries, so it reads as filler. This guard blocks that tail at write time. Fleet
convention: `-guard` blocks, `-nudge` nudges.

## What it catches

The `description` value, once trailing punctuation is trimmed, ends with a
parenthetical whose inner text is a list (items joined by a comma, ` + `, ` / `,
or ` and `) or runs five or more words.

| Description                               | Verdict |
| ----------------------------------------- | ------- |
| `TUI for court lookups (bulk CSV + live)` | blocked |
| `Parser for the Foo format (fast, small)` | blocked |
| `Parser for the Foo format`               | allowed |
| `JSON reader (RFC 8259)`                   | allowed |

The detector is shared with `anti-prose-guard` via
`_shared/trailing-aside.mts`, which flags the same shape on Markdown headings.

## Scope

Only `package.json` and `Cargo.toml` are checked, matched against the normalized
path. Other files pass untouched.

## Bypass

The user types `Allow description-aside bypass` verbatim in a recent turn.

## Test

Specs live in `test/repo/integration/hooks/no-description-aside-guard.test.mts`.
