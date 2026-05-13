# plan-review-reminder

Stop hook that nudges when an assistant turn proposes a plan in prose without the structured shape the fleet's "Plan review before approval" rule requires.

## What it catches

- **Plan phrase without numbered list** — "Here's the plan:" / "My plan is" / "Steps:" / "Approach:" / "I will:" / "Step 1" followed by paragraph prose and no `1.` / `1)` line within 800 characters.
- **Fleet-shared edits without second-opinion invite** — when the plan mentions `CLAUDE.md` / `.claude/hooks/` / `_shared/` / `template/CLAUDE.md` / `sync-scaffolding` / `cascade-tooling` but does not invite a "second opinion" / "review the plan" / "sanity check" / "pair review" pass.

## Bypass

- `SOCKET_PLAN_REVIEW_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
