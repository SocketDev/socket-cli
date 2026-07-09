# delegating-execution

For non-trivial work, planning and review are big-brain jobs; execution and follow-up are floor jobs bounded by the written plan. The four-phase cycle:

```
plan → execute → review → follow-up
```

The plan phase produces a written spec (a `.claude/plans/delegating-<slug>.md` doc) the floor model follows without ambiguity. The review phase catches gaps; the follow-up phase applies them.

## The routing table

Source of truth: `scripts/fleet/lib/delegating-execution/route.mts` (`TIER_TABLE`). The saved workflow carries a comment-linked mirror because workflows cannot import repo TS.

| phase    | sensitivity | model               | effort      | why |
|----------|-------------|---------------------|-------------|-----|
| plan     | benign      | `claude-fable-5`    | `undefined` | big brain; adaptive-only, no effort knob |
| plan     | security    | `claude-opus-4-8`   | `high`      | Fable false-positives on security work; refusal-fallback not live |
| review   | benign      | `claude-fable-5`    | `undefined` | same as plan |
| review   | security    | `claude-opus-4-8`   | `high`      | same as plan |
| execute  | benign      | `claude-sonnet-4-6` | `medium`    | floor executor follows a written plan |
| execute  | security    | `claude-sonnet-4-6` | `medium`    | execution is mechanical either way; the plan carried the sensitivity |
| followup | benign      | `claude-sonnet-4-6` | `medium`    | applies enumerated review findings |
| followup | security    | `claude-sonnet-4-6` | `medium`    | same |

## The security-sensitivity rule

Benign infra/docs planning → Fable (apex tier; per skill-model-routing Tier 4: planning + decomposition is its sanctioned non-escalation use).

Security-sensitive planning (vuln/supply-chain/auth/secrets/hardening — the fleet's daily bread) → Opus 4.8 DIRECTLY: Fable's classifiers false-positive on benign security work, a refusal returns `exitCode: 0` with refusal prose, and the refusal→Opus fallback in `spawnAiAgent` is pending upstream socket-lib (see [fable-fallback](fable-fallback.md)). The default sensitivity is `security` (fail-safe: misrouting benign→Opus costs a little money; misrouting security→Fable silently ships a refusal as output).

When the refusal→Opus fallback lands in socket-lib, the direct-to-Opus rule stays — cheaper and refusal-free beats spawn-then-fallback. The reversal condition is Fable's classifiers stopping the false positives.

Fable's current `suspended: true` in `model-pricing.json` is runtime data the spawn layer honors; the table stays doctrine and self-heals when the flag clears.

## Effort discipline

- The Fable route carries `effort: undefined` (adaptive-only; an effort knob on Fable is a `fable-spawns-have-opus-fallback` Rule 2 violation).
- Opus plan/review pins `effort: 'high'` (heavy reasoning on a multi-file plan; justified).
- Floor execute/followup pins `effort: 'medium'` (multi-file source edits need judgment a haiku/low pass lacks; the plan bounds the reasoning).

## When to use which

- `grilling-plan` — stress-test a plan's CONTENT with the user before building; run it before this skill when the design is unsettled.
- `delegating-execution` — route the EXECUTION of a settled scope across tiers.
- `_shared/multi-agent-backends.md` — the CLI-subprocess layer (codex/opencode/kimi) for non-Anthropic delegation; this skill is the Workflow-harness tier layer above it.

## Staged verification ladder

An execution brief names its verification ladder explicitly, cheapest rung
first, and the executor climbs in order: smoke (the binary runs / the module
imports) → the unit(s) touched → a random sample beyond the touched set →
the full gate (`check --all` + full tests). Each rung gates the next; a
failure drops the executor back to fix-and-re-climb instead of burning the
full-suite budget per iteration. (Bun's Zig→Rust rewrite ran this exact
ladder per workflow loop: `bun --version` → `bun test <file>` → random
files → full CI.)

## Output contract

- Plan doc + fenced execution prompt at `.claude/plans/delegating-<slug>.md` (slug = kebab-case from the task).
- Review findings + follow-up receipts appended to the same doc.
- Plans never land on a committable path (`plan-location-guard`).

## Enforcement

- `scripts/fleet/check/ai-spawns-have-paired-effort.mts` — scans `.claude/workflows/**/*.js` agent() calls (extended to cover the workflow glob).
- `scripts/fleet/check/fable-spawns-have-opus-fallback.mts` — verifies no direct Fable spawn omits the refusal check.
- `scripts/fleet/check/mutating-skills-have-model.mts` — verifies the skill frontmatter declares `model:`.
- `test/unit/fleet/delegating-execution.test.mts` — unit matrix for the full phase × sensitivity table.
