# session-handoff-nudge

Stop hook that flags assistant turns offloading context/session-management onto the user — "I'm deep in this session's context", "best done with fresh context", "your call to continue or stop here", "running low on context", "risk a half-finished".

## Why

Session/context budget is the assistant's plumbing, not the user's decision. Surfacing it ("should I continue or stop?") makes the user manage the model's limits and burns their time on coordination instead of work. The user's reaction to exactly this: "I don't understand what you're wanting me to do with this info?... handle it seamlessly in the background."

## What to do instead

When deep / near a limit, handle continuation seamlessly: write a handoff doc to `<repo>/.claude/plans/<name>.md` capturing done/pending/next-step state (plus pointers to any workflow-output designs), save decisions to memory, and continue — or let compaction / a fresh session resume from the doc. Don't narrate it.

## Detection

- Reminder-only (never blocks).
- Fires on `Stop` when the last assistant message matches a context-burden pattern (`matchContextBurden`).
- Exception: if a recent user turn explicitly said stop/pause/we're-done, the phrasing is acknowledgement — skipped.
