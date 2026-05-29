# Skill model routing

Claude Code supports `model:` + `context: fork` in skill SKILL.md frontmatter. When both are set, invoking the skill forks the conversation onto the declared model for the skill's duration. The rest of the session keeps the user-chosen model.

The fleet uses this to match model capability to task shape:

## Tier 1 — `claude-haiku-4-5` (mechanical)

Skills where the work is "run the tool, commit, push" without judgment:

- `auditing-gha-settings` — drift report
- `cascading-fleet` — propagate wheelhouse template to fleet
- `cleaning-redundant-ci` — sweep orphan workflow files
- `guarding-paths` — path-dedup audit
- `refreshing-history` — squash + reset
- `regenerating-plugin-patches` — regenerate patches against pinned upstream
- `running-test262` — conformance suite runner
- `squashing-history` — git reset/squash
- `updating` — pnpm update + soak
- `updating-coverage` — coverage badge refresh
- `updating-lockstep` — lockstep.json drift bump
- `worktree-management` — worktree create/fanout

These tasks fail-cheap (the sync runner / git command decides what changes), so Haiku's faster latency + lower cost dominates.

## Tier 2 — default model (general dev work)

Skills with some judgment but mostly mechanical:

- `driving-cursor-bugbot` — classify Bugbot threads
- `greening-ci` — watch CI, surface failures
- `handing-off` — conversation → handoff doc
- `plug-leaking-promise-race` — concurrency bug reference
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

## When to override

A skill's declared model is the **default**; the caller can still override via `Skill` tool args or by spawning a subagent with a different `model:` parameter. The fleet convention is: when in doubt, the skill's declared tier wins — overrides should be rare and explanatory.

## Why not `context: fork` everywhere?

Forking copies the parent conversation context to the new model; that has token cost. For tiny one-shot operations, forking + switching wastes more than it saves. The 12 Haiku-declared skills are all multi-step (cascade waves, test suite runs, lockstep traversals) where Haiku's speed/cost win pays back the fork overhead.

## AI-assisted lint fix routing

The same tiering applies to `scripts/ai-lint-fix/cli.mts`, which spawns a headless `claude --print` per file to apply rule-driven rewrites. Routing lives in `scripts/ai-lint-fix/rule-guidance.mts`:

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
