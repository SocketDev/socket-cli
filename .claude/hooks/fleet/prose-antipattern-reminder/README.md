# prose-antipattern-reminder

Stop hook that scans the assistant's most recent turn for AI-writing
antipatterns — the prose Claude drafts for commit bodies, PR descriptions,
CHANGELOG entries, README sections, and docs.

## Why

CLAUDE.md's "Prose authoring" rule: human-facing prose runs through the `prose`
skill before it lands. The skill strips throat-clearing openers, "not X, it's Y"
contrasts, em-dash chains, and vague hedging adverbs. This hook surfaces the same
shapes at turn end so they're caught before they reach a commit or PR.

## What it catches

| Pattern                  | Why it's flagged                                              |
| ------------------------ | ------------------------------------------------------------- |
| em-dash chain (2+ spans) | Reads AI-generated. Break into sentences or use commas.       |
| throat-clearing opener   | "Here's the thing" / "Let me" / "It's worth noting" preamble. |
| "not X, it's Y" contrast | An AI-prose reversal tic. State the point directly.           |
| hedging adverb           | basically / essentially / fundamentally / simply / just.      |

## Why it doesn't block

Stop hooks fire after the assistant has produced its response. Blocking would
truncate the message. The reminder surfaces to stderr so the user reads both and
can revise in the next turn.

## Configuration

`SOCKET_PROSE_ANTIPATTERN_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
