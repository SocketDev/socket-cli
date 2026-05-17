# Agent delegation

When a task fits one of the patterns below, hand it off instead of doing it in the current session. The point is to get a _different model's_ take or to keep heavy work out of the main context — not to avoid effort. Don't delegate trivial tasks: the round-trip overhead isn't worth it for things you can answer in one or two tool calls.

## Delegated work should be small, focused, and quickly answerable

Bias toward short, scoped questions when handing off. The agent on the other end isn't loaded with your conversation state, your tradeoff history, or your half-formed mental model of what "the right answer" looks like — every paragraph of context you have to write into the prompt is one the agent has to re-derive. The right shape is:

- **One question, one ask.** "Is this rewrite safe?" beats "Review this whole branch and tell me what you think." Bundled asks return diluted answers.
- **Concrete scope.** Name the file, the function, the SHA, the diff. "Sanity-check this 40-line diff against the previously-broken pattern" is answerable in one pass; "Audit our cascade infrastructure" isn't.
- **Bounded expected response.** "Under 200 words", "one of: safe / unsafe / unsure with reason", "list the bugs you find". Open-ended prompts produce open-ended replies that take longer to read than the original analysis would have.
- **Fast-loop-friendly.** Prefer 2-minute round-trips over 20-minute ones. If the question genuinely needs a 20-minute investigation, that's a heavyweight `codex:codex-rescue` invocation, not a sanity check — different tool.

A common anti-pattern: sending the entire commit body + every prior message in the thread so the agent "has context." That's not context, that's noise. Restate the question in 3–5 sentences with the specific artifact attached and ask for a verdict.

## Always bound the delegation with a timeout

Agent calls run on someone else's clock — a model that decides to "think harder" can park your conversation for ten minutes while you wait on a one-line verdict. Every delegation must carry an explicit time budget so a stuck or thinky agent doesn't drag the main session down.

- **Subagents (`Agent(...)` calls):** state the expected response shape AND a wall-clock budget in the prompt itself. "Reply in under 200 words within ~2 minutes" gives the agent permission to short-circuit deep investigation. Use `Bash(timeout 120 ...)` when shelling out to `codex` / `claude` / `opencode` CLIs directly — the shell-level timeout is non-negotiable because the CLIs themselves don't always honor cancellation cleanly.
- **Skill-driven CLI subprocesses (Surface 1):** the orchestrator MUST pass `timeout: <ms>` to `spawn(...)` from `@socketsecurity/lib/spawn` so the child is killed when the budget expires. Canonical examples: `scripts/ai-lint-fix/cli.mts` ships a 5-minute per-spawn cap (per-file AI fix is a focused job); `reviewing-code/run.mts` caps heavyweight passes (discovery / discovery-secondary / remediation) at 15 minutes and the verify pass at 5 minutes — the verify pass is a sanity check on an already-written report, so the shorter budget matches the work. New skills pick from the same three tiers below. Anything that needs longer is a manual operation, not a sanity check.
- **Picking the budget:** sanity checks should answer in ~2 minutes; second-implementation passes in ~5; deep rescue work in ~15. Pick the smallest budget that's likely to succeed and let the orchestrator surface a "timed out" failure cleanly. A skipped verdict (with the agent's name and the timeout you used) is more useful than a 20-minute wait that ends in a long, unstructured answer.
- **Failure handling:** treat a timeout as a no-op signal, not an error. The main session continues with its own judgment and reports "asked Codex, no response within budget" — the user can re-invoke with a longer budget if the question genuinely needs it.

## Sanity checks (second-opinion verification)

The highest-value use of mid-conversation delegation is a small, fast _sanity check_ on work the main session just did: a prompt rewrite, a refactor of a sensitive area, a CHANGELOG entry before release, a tricky regex. The companion agent's job is to spot the obvious thing the main session missed — not to redo the work.

Good sanity-check prompts:

- "Here are the original and revised prompt-engineering rule guidance for `prefer-async-spawn` ([before], [after]). Does the revision avoid the orphan-import failure mode? Under 150 words."
- "This diff swaps `spawnSync` for `spawn` in three call sites. Have I correctly updated the return-shape access (`.status` → `.code`)? Yes/no per call site."
- "Read this commit message body. Will downstream consumers understand the cascade direction from this alone? One sentence verdict."

Bad sanity-check prompts:

- "Look at our wheelhouse cascade tooling and tell me if it's good." (too broad)
- "Review the last 12 commits." (no anchor, no specific question)
- "Help me design the next refactor." (that's design work, not verification — use `Plan` or `codex:codex-rescue`)

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
