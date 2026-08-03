# parallel-agent-spawn-nudge

**Event:** PreToolUse (`Task`) · **Type:** nudge (non-blocking)

Fires when the orchestrator spawns an agent whose prompt tells that agent to
**commit / push / land** its own work. Parallel agents committing into one
shared checkout race the git index and the pre-commit hook. The reminder steers
to the safe pattern:

- give each agent a **disjoint** file area,
- have the agent **edit + verify** but leave its work **uncommitted**,
- the **orchestrator** commits, by explicit path (`git commit -o …`).

A single agent on its own throwaway worktree may commit safely, so this nudges
rather than blocks.

**Trigger:** a `Task` tool call whose `prompt` contains a commit/push/land
signal (matched with plain `.includes`, never a command-parsing regex).

**Bypass:** none — it never blocks.

Detail: [`agent-delegation`](../../../../docs/agents.md/fleet/agent-delegation.md).
