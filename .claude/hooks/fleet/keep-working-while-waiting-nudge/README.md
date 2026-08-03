# keep-working-while-waiting-nudge

Stop hook. When the session is about to idle on an in-flight blocker — a remote
CI job it launched to watch, a background shell job, a spawned Workflow, or
background agents — this nudge reminds you that **waiting is not the same as
being blocked**: advance a different queued todo, or tidy the task list, while
the result lands. Only work truly blocked on the pending result should pause.

## What it detects

A scan of the recent assistant tool-use blocks for a wait signal:

- a detached `Bash` call left running (`run_in_background: true`)
- a `Bash` command watching/polling remote CI (`gh run watch`, `gh pr checks
  --watch`, a `gh api …/runs` poll, a bare `sleep` delay)
- a `Workflow` call (background orchestration in flight)
- an `Agent` call not explicitly foregrounded (agents run detached by default)

## Verdict

Notify — never blocks. A Stop hook fires after the turn ended, so there is no
tool call to refuse; the reminder surfaces for the next turn.

See [`judgment-and-self-evaluation`](../../../../docs/agents.md/fleet/judgment-and-self-evaluation.md).
