# prose-tone-reminder

Stop hook. Scans the most-recent assistant turn for three prose-tone
antipattern sets and emits an informational stderr reminder (never blocks).
Merges the former `comment-tone-reminder` + `identifying-users-reminder` +
`perfectionist-reminder` into one process via `runStopReminders` — one stdin
drain + one transcript read for the same turn instead of three.

## Groups + disabling

Each group keeps its original disable env var, so existing muting still works:

- `comment-tone-reminder` — teacher-tone phrases (`note that`, `as you can
  see`, …). Disable: `SOCKET_COMMENT_TONE_REMINDER_DISABLED`.
- `identifying-users-reminder` — "the user wants" / "this user" instead of a
  name or "you". Disable: `SOCKET_IDENTIFYING_USERS_REMINDER_DISABLED`.
- `perfectionist-reminder` — speed-vs-depth choice menus. Disable:
  `SOCKET_PERFECTIONIST_REMINDER_DISABLED`.

## Not merged

`commit-pr-reminder` (AI-attribution, backed by the shared
`_shared/ai-attribution.mts` catalog), the blocking hooks
`dont-blame-user-reminder` / `excuse-detector`, and the NLP hook
`judgment-reminder` stay as their own hooks — different concern or real
per-hook logic.
