# Skill model routing

Claude Code supports `model:` + `context: fork` in skill SKILL.md frontmatter. When both are set, invoking the skill forks the conversation onto the declared model for the skill's duration. The rest of the session keeps the user-chosen model.

The fleet uses this to match model capability to task shape:

## Tier 1 — `claude-haiku-4-5` (mechanical)

Skills where the work is "run the tool, commit, push" without judgment:

- `auditing-gha` — drift report
- `cascading-fleet` — propagate wheelhouse template to fleet
- `cleaning-ci` — sweep orphan workflow files
- `guarding-paths` — path-dedup audit
- `refreshing-history` — squash + reset
- `regenerating-patches` — regenerate patches against pinned upstream
- `running-test262` — conformance suite runner
- `squashing-history` — git reset/squash
- `updating` — pnpm update + soak
- `updating-coverage` — coverage badge refresh
- `updating-lockstep` — lockstep.json drift bump
- `managing-worktrees` — worktree create/fanout

These tasks fail-cheap (the sync runner / git command decides what changes), so Haiku's faster latency + lower cost dominates.

## Tier 2 — default model (general dev work)

Skills with some judgment but mostly mechanical:

- `driving-cursor-bugbot` — classify Bugbot threads
- `greening-ci` — watch CI, surface failures
- `handing-off` — conversation → handoff doc
- `plugging-promise-race` — concurrency bug reference
- `prose` — prose editing
- `trimming-bundle` — stub unused dist/ paths
- `updating-security` — Dependabot resolution

These inherit whatever the user's session is on (typically Sonnet 4.6 or Opus 4.8).

## Tier 3 — `claude-opus-4-8` (heavy reasoning)

Skills where mistakes ship as security incidents or false-negative review passes:

- `reviewing-code` — code review against base ref
- `scanning-quality` — static-analysis bug/race/insecure-default detection
- `scanning-security` — multi-tool security scan + grading

The `.claude/agents/security-reviewer.md` subagent also declares `model: claude-opus-4-8` for the same reason.

## Tier 4 — `claude-fable-5` (apex escalation, never a default)

Fable is the most capable widely-released model and the most expensive on the board, at $10/$50 per MTok in/out. That is roughly 2× Opus 4.8 and 10× Haiku on output. Hidden multipliers compound it further. The Opus-4.7 tokenizer emits about 30% more tokens for the same text, adaptive thinking is always on (no disable), and turns run longer by default. Anthropic itself positions Opus as the default complex-task model and Fable as the escalation: "start with Opus 4.8 … Fable for the highest capability."

No skill, workflow, agent, or programmatic `claude` call declares Fable as its default tier. It is selected manually, for the hardest cases only, and you should prefer to ask before spending it:

- A stuck compiler or native problem (socket-btm, C++ build failures, the ultrathink/acorn parser work), *after* cheaper tiers have failed, never the first reach.
- Planning and decomposition of a large, ambiguous task whose execution chunks then run on cheaper tiers (see below).

Two operational notes for Fable-targeted prompts, from Anthropic's Fable prompting guide (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5). Never instruct it to echo or reproduce its reasoning as response text, because that trips the `reasoning_extraction` refusal and silently falls back to Opus. Expect longer turns, so structure long runs to check asynchronously rather than block. Fable's safety classifiers (offensive-cyber plus bio) can return `stop_reason: "refusal"` on benign security work, so configure fallback to Opus 4.8.

Fable runs adaptive thinking only: it is always on, with no manual thinking-mode or `budget_tokens` control, so effort is the only depth dial and its recommended range tops out at `xhigh` (the `max` level belongs to Opus). The lib reflects this. `buildArgs` (`src/ai/spawn.mts`) omits `--effort` for a Fable or Mythos model rather than pass a level it ignores, and the multi-agent backend registry (`src/ai/backends.mts`) does the same.

The code-level encoding of this ladder is `@socketsecurity/lib`'s `AI_TIER` table (`src/ai/tier.mts`). The `fable` row pins `{ model: 'claude-fable-5', effort: 'xhigh' }` (xhigh is Fable's recommended ceiling; the spawn layer then drops the flag for Fable anyway), and the `token-spend-guard` hook now nudges when Fable runs mechanical work, the same as Opus. Availability-gated routing (`src/ai/route.mts`) resolves a tier to its preferred engine only when that CLI exists and is keyed, falling back to a cross-engine equivalent (Codex GPT-5.5, then an open-weight provider) otherwise.

## Cost-optimized decomposition (plan high, execute cheap)

The economic case for the apex tier is rarely "run the whole task on Fable." It is to spend one Fable (or Opus) call to plan and decompose, then dispatch the execution chunks to the cheapest tier that does each chunk. When execution token volume dominates, which is the usual case, this runs roughly 10–15× cheaper than the task end-to-end on Fable, because each chunk drops from $50/MTok output to $3–5/MTok (or lower on open-weight models).

Routing map across the fleet's existing delegation surfaces:

- Plan, decompose, or hardest debugging → Fable (sparingly) or Opus.
- Code-execution chunks → GPT-5.5-codex via the `codex` plugin (output about $14/MTok, below Sonnet), or Sonnet.
- Bulk, mechanical, or classify-summarize chunks → Haiku, or open-weight Kimi K2.6 / Qwen3.6 via the `delegate` agent (routing to Fireworks or synthetic.new, about $3–4/MTok output; synthetic.new is $30/mo flat for unmetered fan-out).

A `Workflow` is the natural harness for this. The orchestrator (your session model) holds the plan, and each `agent()` chunk declares the cheapest `model:` that does its job. Reserve a Fable `agent()` call for a chunk that genuinely needs apex reasoning, not for the fan-out.

### Plan / execute / review across two providers

The strongest split keeps Claude on the two judgment phases and hands the token-heavy middle phase to Codex on its own subscription:

- **Plan** → Fable 5 at `high`. Break the task down: architecture decisions, file targets, constraints, edge cases. Write a precise implementation brief for Codex that carries the project invariants (this CLAUDE.md ruleset).
- **Execute** → Codex GPT-5.5 at `xhigh`, driven through the `codex:codex-rescue` agent. Codex does the file edits, feature work, refactors, and mechanical sweeps from the brief and hands back a complete diff. This runs on the ChatGPT-plan seat, so the generation tokens never touch the Claude weekly quota.
- **Review** → Fable 5 at `xhigh`. Critically read the Codex diff for correctness, contract adherence, and test impact; run verification (`pnpm run check`, `pnpm test`); accept, or loop Codex with specific corrections. The cycle repeats until the diff passes review.

Fable never writes the code, Codex never decides the design. A note on the Fable effort levels. Fable runs adaptive thinking only: thinking is always on, there is no manual thinking-mode or token-budget knob, so effort is the single dial. Its recommended range tops out at `xhigh` (start at `high`, step to `xhigh` for the most capability-sensitive work); `max` belongs to Opus, not to Fable's recommended ladder. So planning runs `high` and the review pass runs `xhigh`, the most thorough setting Fable's own guidance recommends. The lib does not even forward `--effort` to a Fable model (`buildArgs` in `src/ai/spawn.mts` drops it, since Fable ignores the dial), so set the tier and let Fable self-pace. Because the bulk of generation runs on the ChatGPT plan rather than Claude, this preserves a large share of the Claude weekly headroom (in practice roughly half) for the planning and review calls that genuinely need apex reasoning. That headroom, not dollars, is the binding constraint under a subscription (see below).

### Subscription vs metered API — what you are actually rationing

> **Pricing/leverage data below is a snapshot as of 2026-06-11.** Model prices and plan limits move often; re-verify against vendor docs (and re-run `researching-recency`) before relying on the exact numbers. Treat the ratios as directional, not current.

<!-- MODEL-PRICING-SNAPSHOT: 2026-07-05 -- machine-readable anchor for scripts/fleet/check/pricing-data-is-current.mts. When this date is >35 days old the check reminds you to re-run `/researching-recency` and refresh the figures above + the cost-ladder report, then bump this date. Code is law: the staleness is enforced, not left to memory. -->


The per-token math above is the metered-API view. Most fleet work runs under a flat-rate subscription, and subscriptions are far more generous than $200 of API tokens. A Claude Max 20× plan ($200/mo) bills against roughly $8,000/mo of API-equivalent spend before the weekly cap; a ChatGPT Pro 20× plan reaches roughly $14,000/mo. Under a subscription the marginal dollar cost of a token up to the weekly cap is effectively zero.

So on a subscription the binding constraint becomes **weekly quota / rate-limit headroom**, and dollars stop mattering until the cap. The "Fable is 2× Opus" cost only bites on metered API spend. The decomposition pattern still wins for a different reason: keeping apex calls rare preserves weekly headroom for the tasks that genuinely need them. The metered ladder still governs the `delegate` agent (Fireworks / synthetic.new are usage-billed) and any programmatic `claude --print` run on an API key rather than a subscription seat. Full plan-leverage table in the cost-ladder report under `.claude/reports/`.

## When to override

A skill's declared model is the **default**; the caller can still override via `Skill` tool args or by spawning a subagent with a different `model:` parameter. The fleet convention is: when in doubt, the skill's declared tier wins — overrides should be rare and explanatory.

## Why not `context: fork` everywhere?

Forking copies the parent conversation context to the new model; that has token cost. For tiny one-shot operations, forking + switching wastes more than it saves. The 12 Haiku-declared skills are all multi-step (cascade waves, test suite runs, lockstep traversals) where Haiku's speed/cost win pays back the fork overhead.

## AI-assisted lint fix routing

The same tiering applies to `scripts/fleet/ai-lint-fix/cli.mts`, which spawns a headless `claude --print` per file to apply rule-driven rewrites. Routing lives in `scripts/fleet/ai-lint-fix/rule-guidance.mts`:

- `RULE_MODEL_TIER` — per-rule tier label (`haiku` | `sonnet` | `opus`).
- `TIER_MODEL` — tier-label → model-ID map. Single source of truth for global model bumps.
- `escalateTier(ruleIds)` — picks the highest tier present in a per-file batch.

Tiers by rule:

- **Haiku** (identifier renames, single-token substitutions): `socket/inclusive-language`, `socket/no-placeholders`, `socket/personal-path-placeholders`, `socket/prefer-node-builtin-imports`, `socket/prefer-undefined-over-null`.
- **Sonnet** (control-flow / caller-chain rewrites): `socket/no-fetch-prefer-http-request`, `socket/prefer-async-spawn`, `socket/prefer-exists-sync`.
- **Opus** (module decomposition): `socket/max-file-lines`.

A file's batch may contain multiple rules — the highest tier wins. A Haiku-only batch spawns Haiku; a Haiku+Sonnet batch spawns Sonnet; any `max-file-lines` finding triggers Opus.

When adding a new rule to `AI_HANDLED_RULES`, slot it into `RULE_MODEL_TIER` at the right level. Prompt-engineering invariants follow Anthropic's best practices (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices): XML-structured prompt (`<role>`, `<task>`, `<file>`, `<findings>`, `<rules>`, `<constraint>`, `<output>`), low-freedom per-rule guidance, explicit skip-on-uncertainty constraint.

## Why not fast mode?

Fast mode (`speed: "fast"` + the `fast-mode-2026-02-01` beta header) runs the same Opus weights at up to 2.5x output tokens/sec, but bills at a premium multiplier on standard rates (Opus 4.8 fast = $10/$50 per MTok in/out, above standard Opus 4.8). It is opted into per API request, not via skill `model:` frontmatter, and is access-gated (research preview, account-manager / waitlist). The fleet does not enable it: our skills are throughput-bound, not latency-bound, and the premium fails the "doesn't cost more" bar. An interactive `/fast` toggle in a personal Claude Code session is a per-user choice and touches nothing in this repo. Revisit only if fast mode reaches standard pricing or a genuinely latency-critical skill appears. Source: https://platform.claude.com/docs/en/build-with-claude/fast-mode.
