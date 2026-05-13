# compound-lessons-reminder

Stop hook that flags repeat-finding language in the assistant's most-recent turn that isn't accompanied by rule promotion.

## Why

CLAUDE.md "Compound lessons into rules":

> When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line.

This hook catches the failure mode where the assistant notices a recurring bug class but fixes it again instead of writing the rule that would prevent the next occurrence.

## What it catches

Repeat-finding language in the assistant's prose:

| Pattern | Example |
|---|---|
| `again` / `once more` | "Hitting the same lockfile issue again" |
| `second/third time` | "This is the second time we've seen this regex bug" |
| `same X as before` | "Same monthCode handling bug as we saw earlier" |
| `we've seen this before` | "We've seen this pattern before" |
| `recurring`, `keeps happening` | "Recurring CI failure on the same line" |

Code fences are stripped first so quoted phrases don't false-positive.

If a repeat-finding mention is found, the hook then checks the same turn's tool-use events for evidence of rule promotion:

- Edit/Write to `CLAUDE.md`
- Edit/Write to `.claude/hooks/*`
- Edit/Write to `.claude/skills/*`
- A `**Why:**` line anywhere in the written content (canonical citation shape)

If any of those is present, the hook is satisfied — the rule got written.

## Why it doesn't block

Stop hooks fire after the turn. Blocking would just truncate the assistant's response. The warning prompts the next turn to write the rule.

## Configuration

`SOCKET_COMPOUND_LESSONS_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
