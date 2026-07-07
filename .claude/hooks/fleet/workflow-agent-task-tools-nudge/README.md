# workflow-agent-task-tools-nudge

PreToolUse(Workflow) nudge. Fires when a `Workflow` tool call ships a script
that references a session task tool — `TaskGet`, `TaskUpdate`, `TaskList`,
`TaskCreate`, `TaskOutput`, `TaskStop`.

A workflow script body **and** its `agent()` subagents reach **none** of those
tools: the task store belongs to the main session harness, and a workflow
subagent only gets the standard tools plus MCP via `ToolSearch`. An agent told
to "`TaskGet` your spec" goes in blind — it guesses or burns a turn hunting for
a tool that isn't there. (2026-07-04 overnight run: 3 of 5 socket-lib workflow
steps were skipped exactly this way.)

The pattern that works:

- `TaskGet` the FULL spec in the main loop, then inline it verbatim into the
  `agent()` prompt — the agent has no other way to see it.
- Agents report via structured output (`schema:`), never by calling
  `TaskUpdate`.
- The orchestrator does all `TaskUpdate` bookkeeping after the harvest.
- Tell the agent explicitly it has no task tools so it doesn't waste a turn.

- **Non-blocking.** Notify only; always exits 0. No bypass phrase — a
  descriptive comment about the orchestrator's own bookkeeping is a legitimate
  (if rare) reason for the name to appear, so a block would misfire.
- **Scope.** Only the `Workflow` tool; scans the inline `script` and,
  best-effort, the file at `scriptPath`.

Detection lives in the exported, unit-tested `findTaskToolRef(script)` and
`resolveWorkflowScript(payload)`. Detail: `docs/agents.md/fleet/agent-delegation.md`.
