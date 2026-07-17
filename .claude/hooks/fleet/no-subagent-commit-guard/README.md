# no-subagent-commit-guard

**PreToolUse (Bash) — guard, blocks (exit 2).**

Blocks a `git commit` / `git push` issued from a subagent turn. A delegated
work-product agent returns its work as a report and stops; the parent
orchestrator reviews, re-runs the gates, and lands the change
([agent-delegation](../../../../docs/agents.md/fleet/agent-delegation.md)). One
reviewer sits between the work and the branch, and parallel agents never race
each other on the tree.

## Detection

`mostRecentAssistantIsSidechain` reads the transcript: Claude Code marks a
subagent (Task) turn `isSidechain:true` and the parent orchestrator's turns
false. A commit whose most-recent assistant turn is a subagent is blocked; the
parent's commit always passes, because the parent is the landing gate.

## Scope

An inline Task subagent's turns are written into this transcript, so the guard
catches them. A background / workflow subagent writes to its own transcript, and
its tool call reaches the hook with the parent's transcript, so the guard can't
attribute a background child's commit and stays quiet for it. Those cases are
held by the agent-prompt discipline (every delegation prompt forbids committing)
plus the orchestrator gate. This guard is defense-in-depth for the case the
platform lets it pin.

## Bypass

`Allow subagent-commit bypass` in a recent turn — for the agents whose job is a
commit flow: the `fix` agent's surgical `git commit -o`, and the history-rewrite
skills.

## Test

```sh
pnpm test
```
