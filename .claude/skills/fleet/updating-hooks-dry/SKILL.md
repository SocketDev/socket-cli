---
name: updating-hooks-dry
description: Read-only DRY/KISS sweep of the fleet hook tree (.claude/hooks/fleet/**) and the oxlint plugin (.config/oxlint-plugin/fleet/**). Fans out scanner agents to find copy-paste clusters that should absorb a _shared/ helper, dead _shared/ exports, overlapping guards / redundant lint rules, and KISS smells (a hook far longer than its siblings, regex where the shared AST parser exists). Produces a ranked report under .claude/reports/ with evidence + a concrete consolidation sketch per cluster. Plans only — applies nothing, opens no PR. Sibling of updating-coverage / updating-security under the updating umbrella; the periodic counterpart that keeps the ~170-hook tree from bloating as codifying-disciplines lands new enforcers.
user-invocable: true
allowed-tools: Workflow, Task, Read, Grep, Glob, Write, AskUserQuestion, Bash(node scripts/fleet/check/shared-hook-helpers-are-used.mts:*), Bash(node scripts/fleet/check/hooks-have-no-guard-reminder-overlap.mts:*), Bash(node scripts/fleet/check/hook-registry-is-current.mts:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(wc:*), Bash(cat:*), Bash(head:*), Bash(tail:*)
model: claude-opus-4-8
context: fork
---

# updating-hooks-dry

The fleet hook tree grows every time `codifying-disciplines` lands a new enforcer — and growth invites drift: two hooks that copy-paste the same logic instead of sharing a `_shared/` helper, a `_shared/` export nobody imports anymore, a lint rule and a hook both catching the identical AST shape, a 400-line hook doing one job its 80-line siblings do. This skill **finds** that bloat and writes a plan. It is **read-only and plan-only by design**: it applies nothing and opens no PR (a consolidation is a judgment call a human makes from the report). The one mechanical, safe gate — dead `_shared/` exports — is already a hard check (`shared-hook-helpers-are-used.mts`); this skill is the broader, advisory companion.

## When to use

- Periodically (the operator runs it; not a blocking gate), or after a burst of new hooks from `codifying-disciplines`.
- When the hook tree "feels" repetitive and you want evidence + a consolidation plan before refactoring.

## What it does NOT do

- **Apply changes.** It writes a report; a human (or a follow-up `refactor-cleaner` run) executes. No `Edit`/`Write` to hook source, no commits.
- **Open a PR.** Plan-only by operator directive.
- **Re-litigate the hard gates.** Dead `_shared/` exports already fail `check --all` via `shared-hook-helpers-are-used.mts`; guard/reminder overlap is already checked by `hooks-have-no-guard-reminder-overlap.mts`. This skill SURFACES candidates those gates don't (near-duplicate logic, KISS smells, subsuming lint selectors) and ranks everything for a human.

## Inventory first (inline, before the Workflow)

Scout the surface so the fan-out has a work-list:

1. List hook dirs: `.claude/hooks/fleet/*/` and `.claude/hooks/repo/*/` (exclude `_shared/`).
2. List `_shared/` exports: `rg '^export (async )?function|^export const|^export interface|^export type' .claude/hooks/fleet/_shared/`.
3. List lint rules: `.config/oxlint-plugin/fleet/*/`.
4. Run the existing detectors as ground truth (they never block here — just data):
   - `node scripts/fleet/check/shared-hook-helpers-are-used.mts` — dead `_shared/` exports (advisory).
   - `node scripts/fleet/check/hooks-have-no-guard-reminder-overlap.mts` — known guard/reminder collisions.

## The sweep (Workflow)

Run as a **`Workflow`** (sanctioned opt-in; pass the inventory as `args`). Four read-only scanner dimensions in parallel, then an adversarial verify, then synthesis. Each scanner uses `agentType: 'Explore'` (read-only) and returns a structured finding list.

1. **`phase('Scan')` — four parallel scanners**, each over the hook + lint-rule tree:
   - **Copy-paste clusters** — hooks whose decision logic is near-identical (same parse → same match → same emit shape) and should absorb a `_shared/` helper. Compare STRUCTURE (the AST shape via `_shared/shell-command.mts` concepts), not just text. Schema per finding: `{ kind: 'copy-paste', members: [file:line], sharedHelperProposed, evidence }`.
   - **Dead `_shared/` exports** — start from `shared-hook-helpers-are-used.mts` output; for each candidate, confirm whether it's genuinely unused or consumed out-of-tree (the check is advisory precisely because some `_shared/` exports are consumed by wheelhouse-root or sibling repos). Schema: `{ kind: 'dead-export', symbol, file, confirmedUnused: bool, evidence }`.
   - **Overlapping enforcers** — two enforcers catching the same shape: a lint rule + a hook for an identical AST pattern where one suffices, or two lint rules with subsuming selectors. Schema: `{ kind: 'overlap', enforcers: [name], subsumes, evidence }`.
   - **KISS smells** — a hook/rule far longer than its siblings doing one job; raw regex on a command line where the `_shared/` AST parser exists (the `no-hook-cmd-regex` concern); a hook reimplementing a `_shared/` helper inline. Schema: `{ kind: 'kiss', file, smell, siblingNorm, evidence }`.
2. **`phase('Verify')` — adversarial pass**: per finding, a skeptic tries to REFUTE it — two guards that look similar but guard genuinely different surfaces are NOT a duplicate (e.g. a PreToolUse edit-guard vs a Stop reminder for related-but-distinct concerns the overlap check already knows are fine); a `_shared/` export "unused" in-tree may be consumed by wheelhouse-root. Drop a finding unless the skeptic confirms it's a real consolidation opportunity. Default to refuted when uncertain.
3. **Synthesize** — a final `agent()` writes the ranked report: highest-leverage consolidations first (a `_shared/` helper that would absorb 4 hooks beats a one-off), each with evidence (`file:line`), the proposed consolidation, and a concrete diff sketch.

Return `{ report, findingCount, byKind }`.

## Output

Write the report to **`.claude/reports/hooks-dry-sweep-<YYYY-MM-DD>.md`** (untracked — the fleet `.gitignore` excludes `/.claude/*`; never write it to a committable path, the `report-location-guard` enforces this). The report is the deliverable. Apply nothing.

Report shape:

- **Summary** — finding count by kind; the single highest-leverage consolidation.
- **Per cluster** — kind, members (`file:line`), the proposed `_shared/` helper or merge, a diff sketch, and the blast radius (how many hooks it touches → cascade scope).
- **No silent caps** — if the scan bounded coverage (sampled, top-N), say so. A silent truncation reads as "swept everything" when it didn't.

## Relationship to the hard gates

This skill is the advisory wide net; the deterministic gates are the safety floor. Dead `_shared/` exports → `shared-hook-helpers-are-used.mts` (advisory check). Guard/reminder one-surface-per-concern → `hooks-have-no-guard-reminder-overlap.mts` (hard gate). Hook-registry currency → `hook-registry-is-current.mts`. When this skill finds a pattern worth enforcing deterministically, that itself is a `codifying-disciplines` candidate — promote it to a check rather than re-running the sweep to find it again.
