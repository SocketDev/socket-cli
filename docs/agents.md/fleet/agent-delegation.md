# Agent delegation

When a task fits one of the patterns below, hand it off instead of doing it in the current session. The point is to get a _different model's_ take, or to keep heavy work out of the main context. Don't delegate trivial tasks. The round-trip overhead isn't worth it for things you can answer in one or two tool calls.

## Delegated work should be small, focused, and quickly answerable

Bias toward short, scoped questions when handing off. The agent on the other end has no conversation state, no tradeoff history, no mental model of what "the right answer" looks like. Every paragraph of context you write into the prompt is one the agent has to re-derive. The right shape is:

- **One question, one ask.** "Is this rewrite safe?" beats "Review this whole branch and tell me what you think." Bundled asks return diluted answers.
- **Concrete scope.** Name the file, the function, the SHA, the diff. "Sanity-check this 40-line diff against the previously-broken pattern" is answerable in one pass; "Audit our cascade infrastructure" isn't.
- **Bounded expected response.** "Under 200 words", "one of: safe / unsafe / unsure with reason", "list the bugs you find". Open-ended prompts produce open-ended replies that take longer to read than the original analysis would have.
- **Fast-loop-friendly.** Prefer 2-minute round-trips over 20-minute ones. If the question needs a 20-minute investigation, that's a heavyweight `codex:codex-rescue` invocation, not a sanity check (different tool).

A common anti-pattern: sending the entire commit body + every prior message in the thread so the agent "has context." That's not context, that's noise. Restate the question in 3–5 sentences with the specific artifact attached and ask for a verdict.

## Always bound the delegation with a timeout

Agent calls run on someone else's clock. A model that decides to "think harder" can park your conversation for ten minutes while you wait on a one-line verdict. Every delegation must carry an explicit time budget so a stuck or thinky agent doesn't drag the main session down.

- **Subagents (`Agent(...)` calls):** state the expected response shape AND a wall-clock budget in the prompt itself. "Reply in under 200 words within ~2 minutes" gives the agent permission to short-circuit deep investigation. Use `Bash(timeout 120 ...)` when shelling out to `codex` / `claude` / `opencode` CLIs directly. The shell-level timeout is non-negotiable because the CLIs themselves don't always honor cancellation cleanly.
- **Skill-driven CLI subprocesses (Surface 1):** the orchestrator MUST pass `timeout: <ms>` to `spawn(...)` from `@socketsecurity/lib/spawn` so the child is killed when the budget expires. Canonical examples: `scripts/fleet/ai-lint-fix/cli.mts` ships a 5-minute per-spawn cap (per-file AI fix is a focused job); `reviewing-code/run.mts` caps heavyweight passes (discovery / discovery-secondary / remediation) at 15 minutes and the verify pass at 5 minutes. The verify pass is a sanity check on an already-written report, so the shorter budget matches the work. New skills pick from the same three tiers below. Anything that needs longer is a manual operation, not a sanity check.
- **Picking the budget:** sanity checks should answer in ~2 minutes; second-implementation passes in ~5; deep rescue work in ~15. Pick the smallest budget that's likely to succeed and let the orchestrator surface a "timed out" failure cleanly. A skipped verdict (with the agent's name and the timeout you used) is more useful than a 20-minute wait that ends in a long, unstructured answer.
- **Failure handling:** treat a timeout as a no-op signal, not an error. The main session continues with its own judgment and reports "asked Codex, no response within budget". The user can re-invoke with a longer budget if the question needs it.

## Don't chain long agents back-to-back — the blocked wall-clock compounds

Each `Agent(...)` call BLOCKS the main session until that sub-agent finishes. A per-agent timeout caps one agent; it does nothing about serializing several. Five back-to-back agents at 10–14 minutes each park the conversation for an hour, even though every one of them was "bounded." To the operator that hour is dead wall-clock on a turn that looks stuck.

Before spawning a sub-agent inside a sequence, pick by the work:

- **Inline it** when the piece is small or mechanical: a few edits, a focused read, a verification you can do in two tool calls. The round-trip overhead is not worth it, and inline gives the operator immediate feedback. A relocation that broke two test specs is an inline fix, not a fresh agent.
- **Background or fan out** when the work is heavy AND independent. Pass `run_in_background: true` so it runs while you do other work, or launch one fan-out (`parallel()` / several `Agent` calls in one message) instead of N sequential blocking calls. A read-heavy ingest is a background `Explore`, not a foreground block.
- **Check in between** long agents. After a substantial one returns, report and let the operator redirect before chaining the next. Do not queue three more heavyweight agents on the assumption the plan will not change; it often does.

Rule of thumb: about to spawn your second or third blocking agent in a row? Stop and ask whether the next piece is inline-able, backgroundable, or worth a check-in first. Serial heavyweight delegation is the slowest path to a result, and the one most likely to produce work the operator did not want. Companion hook: `parallel-agent-spawn-nudge`.

## Sanity checks (second-opinion verification)

The highest-value use of mid-conversation delegation is a small, fast _sanity check_ on work the main session just did: a prompt rewrite, a refactor of a sensitive area, a CHANGELOG entry before release, a tricky regex. The companion agent's job is to spot the obvious thing the main session missed, not to redo the work.

Good sanity-check prompts:

- "Here are the original and revised prompt-engineering rule guidance for `prefer-async-spawn` ([before], [after]). Does the revision avoid the orphan-import failure mode? Under 150 words."
- "This diff swaps `spawnSync` for `spawn` in three call sites. Have I correctly updated the return-shape access (`.status` → `.code`)? Yes/no per call site."
- "Read this commit message body. Will downstream consumers understand the cascade direction from this alone? One sentence verdict."

Bad sanity-check prompts:

- "Look at our wheelhouse cascade tooling and tell me if it's good." (too broad)
- "Review the last 12 commits." (no anchor, no specific question)
- "Help me design the next refactor." (that's design work, not verification; use `Plan` or `codex:codex-rescue`)

## Verifying subagent output (their claims are leads, not facts)

A subagent that you fan out to audit/search/review returns a confident, specific, fluent
report. **Treat its structural claims as leads to verify, not facts to relay.** Fan-out
audit agents reliably produce reports that mix real findings with overstatements and
outright inversions — stated with the same confidence.

**What to spot-verify before relaying to the user or acting on it:**

- **Counts** — "52 `-guard` hooks only advise", "TEST_FILE_RE in 6 rules", "17 hooks declare
  their own type". A count is one `grep -c` away from ground truth.
- **File / item lists** — the agent names specific files as having property X. Sample 2–3
  and check; if the sample is wrong, distrust the whole list.
- **Behavior / exit-code / config assertions** — "this guard exits 0 not 2", "this rule is
  type-dependent", "X is cascaded downstream". Read the file / run the command.
- **Negative claims** — "no skill declares effort", "nothing references this". Easiest to
  state, easy to be wrong; one search confirms or kills it.

**How:** re-derive the load-bearing claim from the source. `grep`/read the cited files, run
the one-line command the agent could have run. A file:line citation from an agent is a
pointer to check, not evidence.

**Why this is the rule, not paranoia (incidents):**

- **2026-06-03, DRY/KISS audit:** an agent reported "52 `-guard` hooks only advise (exit 0),
  not block". Spot-checking six named guards: every one exits 2 (blocks). A complete
  inversion of the convention, stated confidently with a 50-file list. One `grep -c
'exit(2)'` killed it.
- **2026-06-03, wheelhouse-segment audit:** an agent flagged 5 hooks/skills as wheelhouse-only
  and movable to `repo/`. Hand-verification (does the dependency exist downstream?) cut it to
  2 — and those 2 turned out to stay too (data-sharing / dispatch-reach). Net real moves: 0.
- Same session, an agent listed "~17 hooks declare their own `ToolInput` type"; the three
  sampled declared none.

**The discriminator** — what makes a claim worth the verification round-trip: it's _cheap to
verify_ (one grep/read) and _expensive to fabricate correctly_ (the agent had to actually
read each file to get the count right, and often didn't). High-confidence + high-specificity

- cheap-to-check = verify it. Vague impressions ("the code seems complex") aren't worth a
  round-trip; precise falsifiable claims are.

**Budget for it.** When you fan out N audit agents, budget the verification pass as part of
the work — it's not optional polish. The synthesized report you hand the user should contain
only what you confirmed, plus an explicit "disproved / unverified" section for the rest. Do
not launder an agent's unchecked claim into your own voice.

There are two delegation surfaces in this fleet. They look similar but are used differently.

## Surface 1: CLI subprocess delegation (skills)

Skills that need multi-model output spawn the agent CLIs (`codex`, `claude`, `kimi`, `opencode`) as subprocesses and fold the results into a report. The contract (backend registry, detection policy, fallback order, attribution) lives in [`_shared/multi-agent-backends.md`](../../.claude/skills/fleet/_shared/multi-agent-backends.md), and the registry itself is `@socketsecurity/lib/ai/backends`. The canonical implementation is [`reviewing-code/run.mts`](../../.claude/skills/fleet/reviewing-code/run.mts).

Use this surface when _the skill itself_ is the orchestrator (multi-pass review, parallel scans, fleet-wide runs).

## Surface 2: subagent delegation (mid-conversation)

When the _current_ Claude session wants to hand off a single task to another model and consume its result inline, use `Agent(subagent_type=…)`. This is in-conversation delegation, not skill orchestration.

| Subagent             | When to use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codex:codex-rescue` | You want GPT-5.5's take or a heavyweight async investigation. Best for: hard debugging you're stuck on, second implementation pass on a tricky design, deep root-cause work. Persistent runtime; check progress with `/codex:status`, get output with `/codex:result`. Also exposed as `/codex:rescue` for user-driven invocation.                                                                                                                                                                     |
| `delegate`           | You want a Fireworks / Synthetic / Kimi open model via [OpenCode](https://opencode.ai). Best for: cheap bulk work (classification, summarization, drafting many things), specialist routing (e.g. Qwen-Coder for code-heavy tasks), second opinions from a non-GPT/non-Claude model. Caller specifies the model in the prompt (e.g. `fireworks/qwen3-coder-480b`). Fire-and-forget. **Optional**: only available if the dev has set up the `delegate` agent locally. Skill code must not depend on it. |
| `Explore`            | Codebase search / "where is X defined" / cross-file lookups. Different model isn't the point; context isolation is.                                                                                                                                                                                                                                                                                                                                                                                    |
| `Plan`               | Implementation strategy for a non-trivial task before writing code.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `general-purpose`    | Open-ended research that doesn't fit the above.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Routing heuristics

- **Stuck after one or two failed attempts** → `codex:codex-rescue`. A different family often breaks the deadlock.
- **About to do 20+ similar small operations** → `delegate` with a cheap model. Keep the main context clean.
- **Want a sanity check on a non-trivial design or diff** → `/codex:adversarial-review` (slash command) _or_ `delegate` to a different family, depending on which perspective is more useful.
- **Big codebase question that'll burn context** → `Explore`.
- **Have a findings report to apply** → `fix` (fleet agent): runs the deterministic fixers (`pnpm run fix`/`format`/the finding's named script) first, then AI-patches the residue one finding at a time, verifying + committing each. The mutating counterpart to the read-only `code-reviewer` — review finds, `fix` applies. Kept separate so a wrong fix for a misdiagnosed finding can't ride in on a review pass.
- **Building a multi-pass workflow** → don't use `Agent(...)` ad hoc; write a skill that uses Surface 1.

## Subagent return contract

A delegated subagent ends in one of four terminal states. Orchestrators route on the state, not on prose, so a subagent that finished with a reservation is handled differently from one that is genuinely stuck. The vocabulary and the escalation each maps to are encoded in `@socketsecurity/lib/ai/subagent-status` (`SubagentStatus` + `escalationFor`); the table below is checked against that type, so the two cannot drift.

| Status               | Meaning                                                   | Orchestrator does                                              |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `done`               | Work complete, no reservations.                           | `advance` to the next unit.                                    |
| `done-with-concerns` | Complete, but the subagent flagged a risk or follow-up.   | `surface` the concern, then advance.                           |
| `needs-context`      | Lacks information it cannot obtain itself.                | `redispatch` with the missing context added (a fresh attempt). |
| `blocked`            | Cannot proceed without a decision only the user can make. | `escalate` to the user and stop.                               |

Two rules fall out of the contract. Never force the same model to retry an unchanged prompt on a non-`done` state: `needs-context` means change the input, `blocked` means hand off. And never silently swallow a `done-with-concerns` — the concern is the point of having a distinct state from `done`.

## Report-back transport: a delegate can never SendMessage its parent

The status contract above rides on a fixed transport, and only three shapes exist (in preference order, so the list order is load-bearing):

1. **Foreground `Agent` call**: the child's final text IS the tool result. Read it there; nothing else arrives.
2. **Background delegate** (`run_in_background: true`): the spawner is re-invoked when the child completes. No polling loop, no message.
3. **Neither available** (e.g. a wave child whose completion signal was lost): the parent polls the delegate's output artifact, or re-runs the verification itself, before ending its turn.

`SendMessage` is not on the list. A spawned delegate cannot address its parent: the parent is not an addressable agent from inside the child, the message bounces ("No agent named '…' is currently addressable"), and the child's report strands in the top-level orchestrator's notification stream. This parked real waves three times in one session; each parent ended its turn "waiting for the delegate's report" that could never arrive. Never instruct a child to SendMessage you back, and never end a turn waiting on a delegate's message. The `excuse-detector` hook blocks that phrasing (`delegateWaitHits`), and the `token-spend-guard` delegation briefing carries the same contract.

## A hook block inside a subagent is a lead, not a diagnosis

When a spawned subagent trips a PreToolUse hook, it reports the block **verbatim** — quotes the `[<guard-name>] …` line the hook emitted, sets `blocked` (or `needs-context` when the cause is a missing env knob), and stops. It does not diagnose the block, attribute it to a "bug" or "incomplete fix", or guess which guard fired and why. Every block message already names its own guard; the interpretation is the orchestrator's job, and the orchestrator owes it the same verify-before-trust it owes any subagent claim: reproduce the block itself before acting on it.

A subagent's confident-but-wrong block diagnosis is expensive. It costs the orchestrator a full verify cycle and can send it editing a guard that was never broken. In one case a subagent reported `node --test … blocked` and invented a shell-quote `2>&1` tokenizer bug; neither reproduced. The only real block was an unrelated package-manager auto-update guard firing because the off-knob was absent from the subagent's env. So every spawn prompt carries the rule explicitly: on a hook block, quote it verbatim and stop — do not diagnose.

## Transformation subagents preserve source verbatim; verify content, not counts

When you delegate a content TRANSFORM (rewrite, reformat, thin, migrate, or anything carrying citations, names, or links, above all the CLAUDE.md law file and the docs), the subagent copies the structured tokens VERBATIM from the source: hook citations, file and symbol names, doc links, version pins. It may compress the prose. It must never regenerate a token from memory. A model paraphrasing "the token-minifier hook" from its training, when the source says `headroom-proxy-start`, silently substitutes a wrong or removed reference that reads plausibly.

The orchestrator's verify-before-trust here is content, not counts. A tally match ("54 bullets, 52 links, all preserved") proves nothing about whether each token is the RIGHT one. A single citation can be silently rewritten to a removed hook while every count still matches. Run the resolving gate (`claude-md-citations-resolve` checks every cited hook and doc exists on disk) and diff preserved tokens against the source. Never sign off on tallies alone. In one case a thin-CLAUDE.md transform subagent rewrote a rule's hook citation from memory to a removed hook name. The counts matched exactly, and only the citation-resolve gate caught the stale token.

Encode both in the spawn prompt: preserve every citation, name, and link verbatim from the source, and do not regenerate from memory. On return, run the resolve gate before landing the subagent's output.

## Fanning out EDITING subagents: isolate, scope to one unit, collect deliberately

Fanning out subagents to READ is low-risk; fanning them out to EDIT shared
files is where a sweep goes off the rails. A broad edit fan-out — several files
per agent, all working the live tree — fails two ways at once: an agent reaches
for a tree-wide `--fix`/formatter to "just clear the lint" and rewrites files it
was never assigned, and concurrent agents race on the same working tree. In one
sweep over fleet-canonical `template/` files, agents told to "edit only your
assigned files" produced an 84-file, ~2,800-line diff (assigned: 30) — a broad
`oxlint --fix` had blown every scope boundary. The whole run was unreviewable
and had to be reverted.

The shape that works for editing fan-outs:

- **The orchestrator owns every SHARED / cross-cutting file.** A file that more
  than one agent needs — a shared test runner, a config, a manifest, a generated
  index — is edited by YOU, once, BEFORE fanning out. Never hand a shared file to
  one agent: it forces every other agent to wait on it (serialization), and if
  two agents edit it in one checkout they clobber each other. Make the shared
  change idempotent and land it first; then each agent branches/works from a tree
  that already has it. (The mistake this prevents: spawning an agent into the
  primary checkout to edit the shared `<style>` conformance runner while three
  port agents also needed it — the fan-out could not start until that one agent
  finished. The fix was to edit the runner in the orchestrator turn, then fan
  out over the disjoint per-language dirs.)
- **One unit per agent.** Scope each agent to a single file (or a small disjoint
  set). One file makes "did it stay in scope?" trivially checkable.
- **`isolation: 'worktree'`.** Each agent edits in its own git worktree, so its
  writes cannot touch the main tree or another agent's files. A stray edit (even
  a broad `--fix`) is confined to that agent's throwaway checkout. This is the
  one case worth the worktree cost.
- **Hard-forbid broad autofixers in the prompt.** No `--fix`/`--write`/formatter,
  no `pnpm run lint/fix/format` — only read-only inspection. That single command
  is what blows scope; ban it explicitly.
- **Collect deliberately — worktree edits do NOT auto-merge.** After the run, copy
  each agent's assigned file(s) out of its worktree into the main tree yourself,
  verifying the worktree changed ONLY those files (strays stay isolated and are
  simply not collected). This collection step IS the scope gate.
- **Verify authoritatively before committing.** The agent's "clean" self-report is
  a lead, not proof (see above). Re-run the real lint over the collected files +
  the full test suite in the main tree; only then commit. A per-rule baseline
  gate (e.g. the dogfood-lint ratchet) guarantees the worst case is "fewer fixed",
  never a regression.

The validated version of the failed sweep above: one worktree-isolated agent per
file, broad fixers banned, collect-and-verify in main — scope held (0 strays),
quality held (named-capture conversions, options-object refactors with in-file
call-site updates), full suite green. Companion hook: `parallel-agent-spawn-nudge`.

**Worktree isolation vs same-checkout disjoint.** `isolation: 'worktree'` is the
safe default when slices are file-level or an agent might reach past its scope.
When the slices are COARSE and cleanly disjoint (a whole language dir per agent),
same-checkout fan-out is viable and skips the per-worktree `pnpm install` cost —
but only under all three guards: (a) the orchestrator owns the shared files
(above), (b) each agent is hard-forbidden broad `--fix`/`format`/`check`
repo-wide (it would see and rewrite siblings' in-flight work), (c) agents leave
work UNCOMMITTED and report a touched-file list, and the orchestrator lands each
by path — no agent runs `git commit` (one reviewer between work and main; no
`.git/index.lock` race).

**Platform limit on the commit control.** `no-subagent-commit-guard` blocks an
inline Task subagent's commit (its turn is `isSidechain` in this transcript), but
a background / Workflow `agent()` subagent writes to its own transcript and its
Bash reaches the hook with the PARENT transcript — so the guard cannot attribute
it and does NOT fire. Likewise a Workflow `agent()` spawn bypasses PreToolUse
entirely, so `parallel-agent-spawn-nudge` never sees it. Those two paths are held
ONLY by the inlined agent-prompt discipline: every delegation's prompt must
forbid committing and instruct "leave work uncommitted, report touched files."
Write that into the prompt; do not rely on a hook to catch it.

Two rules proven at industrial scale (Bun's 1,448-file Zig→Rust rewrite ran
~50 continuous agent workflows for 11 days with every line adversarially
reviewed):

- **Pilot before fan-out.** Any fan-out beyond ~10 agents runs a 1–3 item
  pilot lane first; fold the pilot's failure modes into the prompt before
  scaling. Bun trialed 3 files before committing to 1,448.
- **Reviewer rejection rules are part of the prompt.** Adversarial reviewers
  get named auto-reject patterns beyond "find bugs": (a) a placeholder or
  stubbed-out implementation is an automatic reject; (b) a workaround whose
  justification comment needs a paragraph is wrong code, reject it. Both
  counter the strongest drift agents show under volume.

## When the surfaces overlap

A skill that wants `codex` output should call the CLI (Surface 1) so the result lands in a structured report. A live conversation that wants Codex's opinion on the _current_ problem should use the subagent (Surface 2) so the result flows back into the conversation. Same model, different orchestration.

## Workflow agents have no Task tools — inline the spec

A `Workflow` script's `agent()` subagents (and the workflow script body itself)
reach **none** of the session task tools — `TaskGet`, `TaskUpdate`, `TaskList`,
`TaskCreate`, `TaskOutput`, `TaskStop`. The task store belongs to the main
session harness; a workflow subagent only gets the standard tools plus MCP via
`ToolSearch`. A prompt that tells an agent to "`TaskGet` your spec" sends it in
blind — it can't read the task, so it either guesses or burns its turn searching
for a tool that isn't there.

This is not hypothetical: on the 2026-07-04 overnight run, 3 of 5 socket-lib
workflow steps were skipped because their agents were told to fetch their own
spec from the task store and had no way to.

The pattern that works:

- **`TaskGet` the FULL description in the main loop first**, then inline it
  verbatim into the `agent()` prompt. The agent needs the whole spec in the
  prompt — it has no other way to see it.
- **Agents report via structured output** (`schema:`), never by calling
  `TaskUpdate`.
- **The orchestrator does all task bookkeeping** — `TaskUpdate` status after the
  harvest, in the main session, from the agent's returned result.
- **Tell the agent explicitly it has no task tools** so it doesn't waste a turn
  hunting for `TaskGet` via `ToolSearch`.

Enforcement: `workflow-agent-task-tools-nudge` (PreToolUse on the `Workflow`
tool) flags any Task-tool identifier in the script — a reminder, because a
descriptive comment about the orchestrator's own bookkeeping is a legitimate
(if rare) reason for the name to appear. The workflow author dismisses it or
reworks the prompt.

## Compatibility note

Codex is fleet-wide (the `codex` CLI is a fleet plugin). OpenCode and the `delegate` subagent are **per-developer**: they require local setup outside the repo. Skills that automate work across the fleet must not assume `delegate` exists; humans driving Claude in their own checkout can use it freely.
