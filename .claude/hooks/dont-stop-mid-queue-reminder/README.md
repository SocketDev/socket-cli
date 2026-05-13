# dont-stop-mid-queue-reminder

Stop hook that flags assistant turns announcing "I'm stopping here" / "what's next?" / "honest stopping point" when the user gave a continuous-work directive ("complete each one", "hammer it out", "100%", "do them all") and never authorized a stop.

## Why

The failure mode: the assistant finishes ONE item from a queue the user authorized as a batch, posts a status summary listing what's left, and stops — instead of continuing to the next item. The user has to re-issue "keep going" every time. That re-litigates intent the user already gave and burns the user's time on coordination instead of work.

## What it catches

Stopping-announcement phrases in the last assistant turn:

- "stopping here" / "I'll stop here" / "I'm stopping"
- "honest stopping point" / "natural stopping point" / "clean stopping point" / "good stopping point"
- "pausing here" / "I'm pausing"
- "want me to continue?" / "should I keep going?" / "shall I continue?"
- "what's next?"
- "pick a/the next item/task/one"
- "stop for this session" / "stopping for this session"
- "session totals" / "final session state" / "session summary"
- "remaining queue:" followed by a bulleted list

Code fences are stripped before matching — `// stopping here` inside a code block does not fire.

## Short-circuit: user-authorized stops

If any of the 3 most recent user turns contains an explicit stop signal — "stop", "pause", "hold", "halt", "wait", "we're done", "that's enough", "enough for now/today", "let's stop", "let's pause" — the hook exits 0. In those cases the assistant is just acknowledging.

## What it does NOT catch

- Genuine blockers ("the build needs to run for 2 hours") — those announce a wait, not a stop.
- Final turns of a single-item request (no queue → nothing to mid-queue-stop).
- The assistant deciding mid-task that it needs user input ("which option do you prefer?") — that's a clarification, not a stop.

## Bypass

- `SOCKET_DONT_STOP_MID_QUEUE_REMINDER_DISABLED=1` — turn off entirely.

This hook is a soft reminder (exit 0 with stderr message), not a blocker (exit 2). The Stop event runs *after* the turn is over; blocking would be too late to be useful. Instead, the next assistant turn sees the reminder in its context.

## Test

```sh
pnpm test
```
