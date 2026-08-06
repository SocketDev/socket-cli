# Long-running background tasks

Companion to the `long-running-task-nudge` bullet in `CLAUDE.md`. It catches a background Workflow run, Agent, or Bash task that grinds without visible progress, so the orchestrator verifies it early instead of discovering an hour-long thrash after the fact.

## The problem

A background task can grind on one hard task far longer than it should: a huge transcript, many failed conformance iterations, no forward motion. The orchestrating session is busy elsewhere and does not notice until the run has already burned an hour. The cost is wasted tokens plus a monopolized test gate and shared index.

The fix is early visibility. When a running background task passes a modest age threshold, remind the orchestrator to check whether it is progressing and, if stuck, to stop it and research the real root cause.

## Threshold

`LONGRUN_MINUTES = 2` is the first tier. `LONGRUN_ESCALATE_MINUTES = 5` is the second, louder tier. Both are named constants in the hook, the single source for the age math and the warn-once bookkeeping.

Two minutes is deliberately impatient. An early check costs one cheap `ps` or one read of the log; a late one costs the entire silent stretch. A pre-push gate once ran nineteen minutes unexamined on the reasoning that a multi-language coverage lane emits nothing while it works - which was true, and still not a reason to have waited that long to confirm it. Tests express their fixtures relative to these constants rather than as literal minutes, so retuning a tier does not silently change which tier a test covers.

## Mechanism

The hook binds to `PostToolUse` with no matcher, so it runs after every tool call. `PostToolUse` is the only event that fires periodically during an active turn, which makes it the natural clock for an elapsed-time check. The fleet already runs `PostToolUse` nudges this way.

Task discovery reads three on-disk sources. The first two derive from the payload's `transcript_path` at `~/.claude/projects/<slug>/<session>.jsonl`; the third sits under a different root and is described below it:

1. Background Workflow runs at `<session>/workflows/wf_*.json`. Each file carries `runId`, `status`, and `startTime` in epoch milliseconds. A run is terminal when its status is one of `completed`, `killed`, `failed`, `error`, or `cancelled`; anything else is running. Age is `now - startTime`.
2. Background Agents at `<session>/subagents/agent-*.jsonl` with an `agent-*.meta.json` companion. There is no status field, so an agent counts as running while its transcript mtime is fresh within the live window. Age is `now - ctime` of the transcript.
3. Background Bash tasks at `<tmpRoot>/claude-<uid>/<cwd-slug>/<session>/tasks/<id>.output`. This root is derived from the cwd and session id, not from the transcript. Symlinked entries are skipped: an Agent task is symlinked to its subagent transcript and the agent arm already counts it, so following one would double-report.

Nothing on disk distinguishes a finished Bash task from a running one, so what gets measured for that arm is **silence**: `now - mtime` of the output file. A command that redirects its output to a log never touches this file and therefore reads as silent for its whole run - which is the intended reading, because output you cannot see is progress you have not verified. `BASH_TASK_STALE_CEILING_MS` (30 minutes) bounds the other end: past that a task is history, not a live concern, and without the ceiling every finished task in a long session's tasks dir would nudge on the next tool call.

Paths anchor on `os.homedir()`, the payload `transcript_path`, and the payload `cwd`. The one hardcoded root is the tmp dir the harness itself owns, and it is an injectable parameter so the derivation stays testable.

## Warn once per tier

The hook warns once per task per threshold crossing. It keeps a fail-open JSON store at `.cache/socket-long-running-task-nudge/<session>.json` mapping each task id to the highest tier already warned. A task re-warns only when it crosses into a higher tier, so a steady `PostToolUse` stream does not spam the same notice.

## Caveat

`PostToolUse` fires only while the orchestrator is itself making tool calls. If the orchestrator sits fully idle waiting on the background task, no `PostToolUse` fires and the nudge lands at its next tool call rather than at the exact two-minute mark. That is on goal: the point is to prompt the orchestrator to verify progress the next time it acts.

## What to do when it fires

Verify the task is progressing: its transcript is still growing, its result count is rising, or its phase is advancing. Use `TaskGet` or read the transcript to confirm forward motion. If the task is stuck, repeating the same failed step with no new output, `TaskStop` it and research the real root cause before relaunching.

Triage the stuck step by domain. When the failing step is lint or format and the toolchain has an autofixer, the first move is the autofixer over the affected files, `pnpm run fix` or the tool's `--fix`, and verification is re-running the linter; its exit code is the proof. Plant-probes and per-finding hand-verification are reserved for semantic domains with no autofixer. The nudge text carries this triage via `AUTOFIX_FIRST_GUIDANCE` in the hook; the fuller method split lives in [adversarial-self-review](adversarial-self-review.md).

## Waiting discipline

The inverse failure also happened: an orchestrator watching a background workflow blocked its own foreground on nine-minute `sleep && poll` cycles, minutes of silence per cycle with zero interim output, for a run whose completion the workflow system already delivers as a notification. The wait added silence, not information.

Three clauses govern waiting on anything long-running:

1. A job that notifies on completion - a background task, a Workflow run, `gh run watch` launched as a background job - is never watched with a blocking sleep. Launch it, tell the user what is running and what event comes next, then end the turn. The completion notification re-invokes you.
2. When active polling is genuinely required because no notification exists, cap each silent interval at 60-90 seconds and emit an interim one-liner every cycle: what changed, what is still pending.
3. Status updates name concrete progress, a result count or a last-activity age, never a bare "still running".

The mechanical slice is enforced by `waiting-discipline-nudge` (PreToolUse Bash): a foreground command whose longest single `sleep` invocation totals 120 seconds or more, bare or chained with a poll, draws the rule before the silence starts. The rule text is `WAITING_DISCIPLINE_GUIDANCE` in `.claude/hooks/fleet/_shared/waiting-discipline.mts`, shared with this hook's own nudge so an orchestrator told to check a grinding task also sees how to wait on it. The judgment slice, choosing to end the turn instead of camping on the result, lives with the speech rules in [judgment-and-self-evaluation](judgment-and-self-evaluation.md).

## Enforcement

- `.claude/hooks/fleet/long-running-task-nudge/` (PostToolUse) - the mechanism documented above; warns once per tier when a background Workflow, Agent, or Bash task crosses the 2- or 5-minute threshold with no visible progress.
- `.claude/hooks/fleet/waiting-discipline-nudge/` (PreToolUse Bash) - blocks a blocking-sleep wait pattern on a job that already notifies on completion.
