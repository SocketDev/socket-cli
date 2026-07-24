# waiting-discipline-nudge

PreToolUse Bash hook. Fires before a foreground command blocks on a long
`sleep` — bare, or chained with a poll like `sleep 540 && gh api …/runs` —
and draws the waiting-discipline rule while the silence can still be avoided.

## The rule

1. A job that notifies on completion — a background task, a Workflow run,
   `gh run watch` running as a background job — is never watched with a
   blocking sleep. Background it, say what is running and what event comes
   next, then end the turn.
2. When polling is genuinely required because nothing notifies, cap each
   silent interval at 60-90s and emit an interim one-liner every cycle: what
   changed, what is still pending.
3. Status updates name concrete progress, a result count or a last-activity
   age, never a bare "still running".

## What it detects

A `Bash` command whose longest single `sleep` invocation totals
`WAIT_SLEEP_NUDGE_SECONDS` (120 seconds) or more, in command position and with
GNU duration semantics: multiple arguments sum, `s`/`m`/`h`/`d` suffixes
apply. The max across invocations is used because a poll between two sleeps
breaks the silence. Detached commands (`run_in_background: true`) are skipped
— a background shell does not silence the turn.

## Verdict

Notify — never blocks. Shares `WAITING_DISCIPLINE_GUIDANCE` with
`long-running-task-nudge` via `_shared/waiting-discipline.mts` so the rule
wording cannot drift between the two surfaces.

See [`long-running-tasks`](../../../../docs/agents.md/fleet/long-running-tasks.md)
and [`judgment-and-self-evaluation`](../../../../docs/agents.md/fleet/judgment-and-self-evaluation.md).
