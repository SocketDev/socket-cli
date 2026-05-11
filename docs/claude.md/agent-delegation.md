# Agent delegation

When a task fits one of the patterns below, hand it off instead of doing it in the current session. The point is to get a _different model's_ take or to keep heavy work out of the main context — not to avoid effort. Don't delegate trivial tasks: the round-trip overhead isn't worth it for things you can answer in one or two tool calls.

There are two delegation surfaces in this fleet. They look similar but are used differently.

## Surface 1 — CLI subprocess delegation (skills)

Skills that need multi-model output spawn the agent CLIs (`codex`, `claude`, `kimi`, `opencode`) as subprocesses and fold the results into a report. The contract — backend registry, detection policy, fallback order, attribution — lives in [`_shared/multi-agent-backends.md`](../../.claude/skills/_shared/multi-agent-backends.md). The canonical implementation is [`reviewing-code/run.mts`](../../.claude/skills/reviewing-code/run.mts).

Use this surface when _the skill itself_ is the orchestrator (multi-pass review, parallel scans, fleet-wide runs).

## Surface 2 — Subagent delegation (mid-conversation)

When the _current_ Claude session wants to hand off a single task to another model and consume its result inline, use `Agent(subagent_type=…)`. This is in-conversation delegation, not skill orchestration.

| Subagent             | When to use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex:codex-rescue` | You want GPT-5.4's take or a heavyweight async investigation. Best for: hard debugging you're stuck on, second implementation pass on a tricky design, deep root-cause work. Persistent runtime — check progress with `/codex:status`, get output with `/codex:result`. Also exposed as `/codex:rescue` for user-driven invocation.                                                                                                                                                                     |
| `delegate`           | You want a Fireworks / Synthetic / Kimi open model via [OpenCode](https://opencode.ai). Best for: cheap bulk work (classification, summarization, drafting many things), specialist routing (e.g. Qwen-Coder for code-heavy tasks), second opinions from a non-GPT/non-Claude model. Caller specifies the model in the prompt (e.g. `fireworks/qwen3-coder-480b`). Fire-and-forget. **Optional** — only available if the dev has set up the `delegate` agent locally. Skill code must not depend on it. |
| `Explore`            | Codebase search / "where is X defined" / cross-file lookups. Different model isn't the point — context isolation is.                                                                                                                                                                                                                                                                                                                                                                                    |
| `Plan`               | Implementation strategy for a non-trivial task before writing code.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `general-purpose`    | Open-ended research that doesn't fit the above.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Routing heuristics

- **Stuck after one or two failed attempts** → `codex:codex-rescue`. A different family often breaks the deadlock.
- **About to do 20+ similar small operations** → `delegate` with a cheap model. Keep the main context clean.
- **Want a sanity check on a non-trivial design or diff** → `/codex:adversarial-review` (slash command) _or_ `delegate` to a different family, depending on which perspective is more useful.
- **Big codebase question that'll burn context** → `Explore`.
- **Building a multi-pass workflow** → don't use `Agent(...)` ad hoc; write a skill that uses Surface 1.

## When the surfaces overlap

A skill that wants `codex` output should call the CLI (Surface 1) so the result lands in a structured report. A live conversation that wants Codex's opinion on the _current_ problem should use the subagent (Surface 2) so the result flows back into the conversation. Same model, different orchestration.

## Compatibility note

Codex is fleet-wide (the `codex` CLI is a fleet plugin). OpenCode and the `delegate` subagent are **per-developer** — they require local setup outside the repo. Skills that automate work across the fleet must not assume `delegate` exists; humans driving Claude in their own checkout can use it freely.
