# Long-running background tasks

Companion to the `long-running-task-nudge` bullet in `CLAUDE.md`. It catches a background Workflow run or background Agent that grinds on one task without progress, so the orchestrator verifies it early instead of discovering an hour-long thrash after the fact.

## The problem

A background task can grind on one hard task far longer than it should: a huge transcript, many failed conformance iterations, no forward motion. The orchestrating session is busy elsewhere and does not notice until the run has already burned an hour. The cost is wasted tokens plus a monopolized test gate and shared index.

The fix is early visibility. When a running background task passes a modest age threshold, remind the orchestrator to check whether it is progressing and, if stuck, to stop it and research the real root cause.

## Threshold

`LONGRUN_MINUTES = 5` is the first tier. `LONGRUN_ESCALATE_MINUTES = 10` is the second, louder tier. Both are named constants in the hook, the single source for the age math and the warn-once bookkeeping.

## Mechanism

The hook binds to `PostToolUse` with no matcher, so it runs after every tool call. `PostToolUse` is the only event that fires periodically during an active turn, which makes it the natural clock for an elapsed-time check. The fleet already runs `PostToolUse` nudges this way.

Task discovery reads two on-disk sources, both derived from the payload's `transcript_path` at `~/.claude/projects/<slug>/<session>.jsonl`:

1. Background Workflow runs at `<session>/workflows/wf_*.json`. Each file carries `runId`, `status`, and `startTime` in epoch milliseconds. A run is terminal when its status is one of `completed`, `killed`, `failed`, `error`, or `cancelled`; anything else is running. Age is `now - startTime`.
2. Background Agents at `<session>/subagents/agent-*.jsonl` with an `agent-*.meta.json` companion. There is no status field, so an agent counts as running while its transcript mtime is fresh within the live window. Age is `now - ctime` of the transcript.

Paths anchor on `os.homedir()` and the payload `transcript_path`, never a hardcoded temp path.

## Warn once per tier

The hook warns once per task per threshold crossing. It keeps a fail-open JSON store at `node_modules/.cache/socket-long-running-task-nudge/<session>.json` mapping each task id to the highest tier already warned. A task re-warns only when it crosses into a higher tier, so a steady `PostToolUse` stream does not spam the same notice.

## Caveat

`PostToolUse` fires only while the orchestrator is itself making tool calls. If the orchestrator sits fully idle waiting on the background task, no `PostToolUse` fires and the nudge lands at its next tool call rather than at the exact five-minute mark. That is on goal: the point is to prompt the orchestrator to verify progress the next time it acts.

## What to do when it fires

Verify the task is progressing: its transcript is still growing, its result count is rising, or its phase is advancing. Use `TaskGet` or read the transcript to confirm forward motion. If the task is stuck, repeating the same failed step with no new output, `TaskStop` it and research the real root cause before relaunching.

Triage the stuck step by domain. When the failing step is lint or format and the toolchain has an autofixer, the first move is the autofixer over the affected files — `pnpm run fix` or the tool's `--fix` — and verification is re-running the linter; its exit code is the proof. Plant-probes and per-finding hand-verification are reserved for semantic domains with no autofixer. The nudge text carries this triage via `AUTOFIX_FIRST_GUIDANCE` in the hook; the fuller method split lives in [adversarial-self-review](adversarial-self-review.md).

## Waiting discipline

The inverse failure also happened: an orchestrator watching a background workflow blocked its own foreground on nine-minute `sleep && poll` cycles, minutes of silence per cycle with zero interim output, for a run whose completion the workflow system already delivers as a notification. The wait added silence, not information.

Three clauses govern waiting on anything long-running:

1. A job that notifies on completion — a background task, a Workflow run, `gh run watch` launched as a background job — is never watched with a blocking sleep. Launch it, tell the user what is running and what event comes next, then end the turn. The completion notification re-invokes you.
2. When active polling is genuinely required because no notification exists, cap each silent interval at 60-90 seconds and emit an interim one-liner every cycle: what changed, what is still pending.
3. Status updates name concrete progress, a result count or a last-activity age, never a bare "still running".

The mechanical slice is enforced by `waiting-discipline-nudge` (PreToolUse Bash): a foreground command whose longest single `sleep` invocation totals 120 seconds or more, bare or chained with a poll, draws the rule before the silence starts. The rule text is `WAITING_DISCIPLINE_GUIDANCE` in `_shared/waiting-discipline.mts`, shared with this hook's own nudge so an orchestrator told to check a grinding task also sees how to wait on it. The judgment slice, choosing to end the turn instead of camping on the result, lives with the speech rules in [judgment-and-self-evaluation](judgment-and-self-evaluation.md).
