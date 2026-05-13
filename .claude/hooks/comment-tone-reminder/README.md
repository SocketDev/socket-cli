# comment-tone-reminder

Stop hook that scans the assistant's most recent turn for teacher-tone phrases that would read condescendingly if written into a code comment.

## Why

CLAUDE.md's "Code style → Comments" rule: comments default to none; when written, the audience is a junior dev — explain the constraint, the hidden invariant, the "why this and not the obvious thing." No teacher-tone preamble.

The patterns this hook flags are predictable shapes: "First, we will...", "Note that...", "It's important to...", "As you can see...", "Remember that...", "In order to...".

## What it catches

| Phrase | Why it's flagged |
|---|---|
| `first, we (will\|are\|need\|should)` | Step-by-step narration — drop the framing. |
| `note that` | Tutorial filler. State the load-bearing point directly. |
| `it's important to` | Don't announce importance — state the constraint. |
| `as you can see` | Presupposes reader engagement. Drop. |
| `remember (that\|to)` | Reader doesn't need reminding — state the rule. |
| `in order to` | Wordy. "To X" suffices unless contrasting paths. |

## Why it doesn't block

Stop hooks fire after the assistant has produced its response. Blocking would truncate the message. The warning surfaces to stderr alongside the response so the user reads both and can push back in the next turn.

## Configuration

`SOCKET_COMMENT_TONE_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
