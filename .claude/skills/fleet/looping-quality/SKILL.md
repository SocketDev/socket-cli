---
name: looping-quality
description: Run scanning-quality, fix findings, and repeat until clean or the configured iteration limit is reached.
user-invocable: true
allowed-tools: Skill, Task, Read, Grep, Glob, Bash(pnpm run check:*), Bash(pnpm run test:*), Bash(pnpm test:*), Bash(pnpm run build:*), Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*)
model: claude-sonnet-4-6
---

# looping-quality

A thin **loop counter** over the [`scanning-quality`](../scanning-quality/SKILL.md)
primitive. `scanning-quality` is one pass — fan out finders, dedup, verify,
produce an A-F report. This skill wraps it in an iterate-fix-recheck loop: scan,
fix the findings, scan again, until the report is clean or the iteration cap is
hit. All the scanning logic lives in `scanning-quality`; this skill only adds the
counter and the fix-and-recheck cadence.

**Interactive only** — this skill makes code changes and commits. Do not use as
an automated pipeline gate (that's what a single `scanning-quality` report is
for).

## Process

Track an iteration counter `N`, starting at 1, capped at `MAX_ITERATIONS = 5`.

1. **Scan.** Run the `scanning-quality` skill (all scan types). It returns the
   A-F report + findings.
2. **Done check.** If zero findings → success; report the clean pass and stop.
3. **Fix.** Spawn the `refactor-cleaner` agent (see `agents/refactor-cleaner.md`)
   to fix the findings, grouped by category. Honor CLAUDE.md's pre-action
   protocol: dead code first, then structural changes, ≤5 files per phase.
4. **Verify.** Run verify-build (see `_shared/verify-build.md`) and the test
   suite after fixes to confirm nothing broke.
5. **Commit.** `fix: resolve quality scan issues (iteration N)`.
6. **Loop.** Increment `N`. If `N > MAX_ITERATIONS`, stop and report remaining
   findings. Otherwise go to step 1.

## Rules

- Fix every finding, not just the easy ones.
- One commit per iteration; the iteration number is in the commit subject so the
  trend is visible in `git log`.
- Run tests after each fix batch — a fix that breaks the build is not a fix.
- The heavy scanning work is delegated to `scanning-quality` (which pins opus);
  this skill just orchestrates the loop, so it runs on a lighter model.
- Report the final state: iterations run, findings fixed, anything still open at
  the cap.
