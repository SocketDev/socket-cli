# yakback-reminder

Stop hook. Scans the most-recent assistant turn for voice/tone antipattern sets
and emits an informational stderr reminder (never blocks). Merges
`comment-yakback-reminder` + `identifying-users-reminder` + `perfectionist-reminder`
+ `self-narration-reminder` into one process via `runStopReminders` — one stdin
drain + one transcript read for the turn instead of one per group.

Distinct from `prose-antipattern-guard`: that PreToolUse hook BLOCKS AI-writing
patterns in committed prose files (CHANGELOG / docs / README); this one nudges on
Claude's conversational + comment voice across the whole turn.

## Groups

- `comment-yakback-reminder` — teacher-tone phrases (`note that`, `as you can
see`, …).
- `identifying-users-reminder` — "the user wants" / "this user" instead of a
  name or "you".
- `perfectionist-reminder` — speed-vs-depth choice menus.
- `self-narration-reminder` — unprompted status recaps, "now let me" tool-use
  narration, conversational hedges ("honestly", "to be fair"), reflexive
  apology/agreement padding.

## Heuristic, by design

These are regex tone-sniffs, not a parser — they over-fire. A line-start "let me"
inside an explanation, or a "you're absolutely right" that is genuinely warranted,
will trip the group. That is acceptable: the group only reminds, never blocks, so
a false positive costs nothing but a glance. The reflexive-agreement pattern stays
deliberately broad — the goal is less gassing-up the user, and an occasional
flag on a sincere acknowledgment is the cheap side of that trade. Treat a match as
a prompt to re-read the sentence, not a verdict.

## Not merged

`commit-pr-reminder` (AI-attribution, backed by the shared
`_shared/ai-attribution.mts` catalog), the blocking hooks
`dont-blame-reminder` / `excuse-detector`, and the NLP hook
`judgment-reminder` stay as their own hooks — different concern or real
per-hook logic.
