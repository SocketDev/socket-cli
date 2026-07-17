---
name: grilling-plan
description: Stress-test a plan one question at a time before building, especially for shared fleet resources.
---

# grilling-plan

The proactive complement to `plan-review-nudge` (the after-plan gate). Interview
the user relentlessly about every branch of the design tree until you reach
shared understanding — then the plan is ready to land.

## 1. Resolve the deterministic questions first

Before asking the user anything, answer every question the codebase already
answers — this is the `code-first-then-ai` discipline applied to design. If the
change proposes a NEW enforcement surface (hook, lint rule, check, skill, agent),
run the inventory and compare:

```sh
node scripts/fleet/codify-scan/inventory.mts
```

It emits the authoritative set of existing hooks / lint rules / checks / docs.
If the thing you'd build already exists, the answer is "extend it", not "add one"
— don't ask the user a question `grep` or the inventory settles. Read the
relevant files in place. Only what the codebase *cannot* answer goes to the user.

## 2. Interview one question at a time

Ask the residue — the design-intent questions no script resolves: trade-off
framing, naming, cascade blast-radius, the reversal condition. Rules:

- **One question at a time.** Wait for the answer before the next. Multiple
  questions at once is bewildering.
- **Every question carries your recommended answer** and the reason, so the user
  can accept with one word.
- **Walk the tree in dependency order** — resolve a decision its children depend on
  before descending.
- If a later answer can be derived from an earlier one, derive it; don't re-ask.

## 3. Gate before landing

A fleet-shared change is settled only when the plan has the shape
`plan-review-nudge` checks for:

- Numbered steps, each naming the real files + rules it touches.
- The final name / schema shape decided up front (a name that will cascade must
  not churn across commits).
- A second-opinion invite when the plan edits a fleet-shared resource
  (`CLAUDE.md`, `template/`, `.claude/hooks/`, `_shared/`).

## Completion criterion

Every design-tree branch is resolved (by the codebase or by the user), the plan
names its files + rules in numbered steps, the cascaded names are settled, and —
for a fleet-shared change — a second opinion has been invited. Then write the plan
to `.claude/plans/<name>.md` and execute.
