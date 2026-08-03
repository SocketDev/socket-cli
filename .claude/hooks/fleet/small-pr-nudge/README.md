# small-pr-nudge

PreToolUse Bash hook (reminder, NOT a block) that nudges toward a smaller
PR when an agent runs `gh pr create` on a large diff. Fleet PRs stay
small: one logical feature/fix, ~200 changed lines.

## Why

Per CLAUDE.md's small-PR guidance and the commit-cadence doctrine, a PR
carries one logical change and targets ~200 changed lines. Small units
keep review sharp and agents constrained. This is Depot's point that
guardrails increase, not limit, AI usefulness: a tight change boundary is
what lets a reviewer trust an agent's diff.

The fleet direct-pushes to main, so it realizes this doctrine primarily as
small commits landed fast (see `commit-cadence-nudge` + the land-fast
cadence). A PR happens only on push-rejection or for external / cross-repo
work. This hook enforces the size ceiling on that rare PR path.

## What it catches

`gh pr create` / `gh pr new` whose proposed diff exceeds ~200 changed
lines. The diff is the three-dot range `git diff --shortstat <base>...HEAD`
(HEAD vs the merge base with `base`), which is what a PR actually proposes.
The base is the explicit `--base` / `-B` value, else the repo default
branch resolved from `origin/HEAD`.

Detection of the `gh pr create` invocation and the `--base` flag is
**AST-based** (the shell-quote-backed `shell-command.mts` parser, not
regex), so `&&` chains, quoting, and `$(…)` are handled correctly.

## The suggestion

Decompose the change into smaller landed commits, or stack it:

    gh pr create --base <previous-branch>

Stacking chains a follow-up PR on the branch before it, so each link stays
small and reviewable.

## Not a block

Reminder-only. The agent can still proceed with `gh pr create` when the
large PR is the correct action.

## Skipped scenarios

- A command that is not `gh pr create` / `gh pr new`.
- A PR whose diff is ~200 changed lines or fewer.
- The diff can't be computed (not a git repo, base ref absent, git
  errored) — the hook fails open, no reminder.
