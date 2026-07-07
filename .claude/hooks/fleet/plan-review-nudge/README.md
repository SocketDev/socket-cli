# plan-review-nudge

Stop hook that nudges when an assistant turn proposes a plan in prose without the structured shape the fleet's "Plan review before approval" rule requires.

## What it catches

- **Plan phrase without numbered list** — "Here's the plan:" / "My plan is" / "Steps:" / "Approach:" / "I will:" / "Step 1" followed by paragraph prose and no `1.` / `1)` line within 800 characters.
- **Fleet-shared edits without second-opinion invite** — when the plan mentions `CLAUDE.md` / `.claude/hooks/` / `_shared/` / `template/CLAUDE.md` / `sync-scaffolding` / `scripts/fleet` but does not invite a "second opinion" / "review the plan" / "sanity check" / "pair review" pass.
- **Unsettled name/schema shape spread across the cascade** — when the plan introduces or renames a name (check / script / hook / lint rule / skill) or a schema/marker field AND signals it lands across multiple files / the cascade / fleet-wide, without language showing the final shape is settled (or the choice routed to the user via `AskUserQuestion`). Renaming a cascaded name or migrating a fleet schema is expensive, so the final shape belongs in the plan, not iterated across commits (motivating churn: the `make-`/`generate-`/`make-` round-trip and the `kind`→`layout+native`→`repo.type` migration).

## Bypass

No bypass — it's a reminder (exit 0), not a block.

## Test

```sh
pnpm test
```
