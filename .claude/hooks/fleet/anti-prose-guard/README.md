# anti-prose-guard

PreToolUse hook that BLOCKS Write/Edit to human-facing prose surfaces —
`CHANGELOG.md`, `docs/**/*.md`, `README.md` — when the new content carries an
AI-writing antipattern.

## Why

CLAUDE.md's "Prose authoring" rule: human-facing prose runs through the `prose`
skill before it lands. The skill strips throat-clearing openers, "not X, it's Y"
contrasts, em-dash chains, and vague hedging adverbs. This guard enforces it as a
hard block at write time — it supersedes the old `prose-antipattern-nudge`
Stop hook (a reminder fires after the write and is ignorable; a PreToolUse block
stops the bad prose from landing). Fleet convention: `-guard` blocks, `-nudge`
nudges — one surface per concern, never both.

## What it catches

| Pattern                  | Why it's flagged                                              |
| ------------------------ | ------------------------------------------------------------- |
| em-dash chain (2+ spans) | Reads AI-generated. Break into sentences or use commas.       |
| throat-clearing opener   | "Here's the thing" / "Let me" / "It's worth noting" preamble. |
| "not X, it's Y" contrast | An AI-prose reversal tic. State the point directly.           |
| hedging adverb           | basically / essentially / fundamentally / simply / just.      |

## Scope

Only the prose surfaces above are guarded — `src/` and other code files are not
scanned for prose patterns. The match runs against the normalized (forward-slash)
path, so it holds on every platform.

## Bypass

The user types `Allow prose-antipattern bypass` verbatim in a recent turn.

## Test

```sh
pnpm test
```
