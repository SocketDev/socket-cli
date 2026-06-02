# compound-lessons-reminder

Stop hook that flags repeat-finding patterns in the assistant's most-recent turn that aren't accompanied by rule promotion.

## Why

CLAUDE.md "Compound lessons into rules":

> When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line.

This hook catches the failure mode where the assistant notices a recurring bug class but fixes it again instead of writing the rule that would prevent the next occurrence.

## What it catches

Two independent signals fire the warning:

### Prose signal

Repeat-finding language in the assistant's prose:

| Pattern                        | Example                                             |
| ------------------------------ | --------------------------------------------------- |
| `again` / `once more`          | "Hitting the same lockfile issue again"             |
| `second/third time`            | "This is the second time we've seen this regex bug" |
| `same X as before`             | "Same monthCode handling bug as we saw earlier"     |
| `we've seen this before`       | "We've seen this pattern before"                    |
| `recurring`, `keeps happening` | "Recurring CI failure on the same line"             |

Code fences are stripped first so quoted phrases don't false-positive.

### Behavioral signal

The current turn edits a fleet-canonical file (hook / skill / agent / lint rule / CLAUDE.md / fleet script / fleet doc) that a prior turn within the same session also edited. Repeated edits to the same canonical surface without a rule-promotion `**Why:**` citation is the actual compound-lessons-into-rules pattern — prose may or may not mention it.

Lookback: 5 prior assistant turns (cheap on long transcripts, broad enough to catch "fix it again 4 turns later").

Surfaces that count:

- `CLAUDE.md` (root, template/, any path)
- `.claude/hooks/fleet/**`
- `.claude/skills/fleet/**`
- `.claude/agents/fleet/**`
- `.claude/commands/fleet/**`
- `.config/fleet/**`
- `scripts/fleet/**`
- `docs/claude.md/fleet/**`

Edits to non-fleet-canonical paths (`src/`, `test/`, repo-local `.claude/hooks/repo/`) don't fire — those aren't fleet-shared surfaces, so the compound-lessons-into-rules pattern doesn't apply.

## Suppression

The warning is suppressed when either signal of rule promotion is present:

| Suppressor                         | Applies to              |
| ---------------------------------- | ----------------------- |
| `**Why:**` line in current turn    | both signals            |
| Edit to CLAUDE.md / hooks/ / skills/ in current turn | prose-only signal       |

The file-path heuristic only suppresses the **prose** signal. The behavioral signal is *itself* an edit to a rule surface, so the file-path heuristic would self-suppress every repeat-edit hit. Only a `**Why:**` citation counts as suppression for the behavioral signal.

## Why it doesn't block

Stop hooks fire after the turn. Blocking would just truncate the assistant's response. The warning prompts the next turn to write the rule.

## Configuration

`SOCKET_COMPOUND_LESSONS_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
