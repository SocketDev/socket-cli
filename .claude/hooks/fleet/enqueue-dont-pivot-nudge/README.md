# enqueue-dont-pivot-nudge

Stop hook that flags assistant turns signalling a focus-pivot to a newly-mentioned topic. It fires when the assistant abandons the in-progress task to chase something the user raised in passing, and the user never authorized a redirect. This is the inverse sibling of `dont-stop-mid-queue-nudge`: that one catches *stopping* mid-queue, this one catches *pivoting* mid-queue.

## Why

A task is in flight. The user says "also do X" or "we should ship Y". The assistant drops the half-done work and refocuses on X, instead of `TaskCreate`'ing X and finishing the current task first. The user has said, in plain terms, "add as I tell you, don't constantly redirect and refocus." A new instruction mid-queue defaults to an add, not a redirect.

## What it catches

The assistant's own pivot language in the last turn (code fences stripped):

- "pivot" / "pivoting to" / "let me pivot"
- "switch gears" / "switching gears"
- "(re)focus on" / "change focus" / "shift focus" / "this changes the focus"
- "new directive" / "directive shift" / "major shift"
- "drop everything" / "set aside the current work"
- "abandon the current work" / "supersedes my current"

## Short-circuit: user-authorized pivots

If any of the 3 most recent user turns authorizes a pivot or interrupt, the hook exits 0. The pivot is what was asked for. Signals: "stop", "drop that", "do this now", "do this first", "urgent", "asap", "before you continue", "switch to X", "interrupt your todos", "this first", "new priority".

## What it does NOT catch

- Within-task transitions like "let me move to the test file". Bare "switch to X" is not a pivot tell.
- A new ask that blocks the current task. The assistant should name why it blocks.
- The first turn of a brand-new request, when nothing is in flight to abandon.

## Why it doesn't block

A soft reminder (exit 0 with a stderr message), not a blocker. The Stop event runs after the turn, so the next assistant turn reads the reminder and can enqueue, then resume.

## Test

```sh
pnpm test
```
