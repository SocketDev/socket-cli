# commit-size-nudge

**PreToolUse (Bash) — nudge, never blocks.**

On a `git commit`, warns when the STAGED diff exceeds **~200 changed lines of
authored source**. Fleet commits stay small (one logical change) so they land
cleanly onto local `main` without cross-worktree collisions and read like a
small reviewable PR.

It is the commit-time twin of `small-pr-nudge`: both target ~200 authored lines.
The fleet direct-pushes to `main`, so the size discipline actually bites here,
at commit time.

## What counts

The size is `git diff --cached --shortstat` with generated and mechanical paths
excluded, so only authored source counts. Excluded: lockfiles
(`pnpm-lock.yaml`, `package-lock.json`), the rolldown-bundled hook dispatcher
(`_dist/bundle.cjs`), and the `build/**`, `dist/**`, `*.min.*`, and `*.snap`
trees. A cascade (`FLEET_SYNC=1`) is exempt outright: a cascade commit is a whole
slice by design.

## Fix

Split into surgical commits, each its own logical change:

```sh
git commit -o <file> -o <file> -m "…"
```

Reminder-only. There is no bypass phrase because it never blocks.

## Trigger

`git commit` (via the shared `isGitCommit` parse). Threshold:
`COMMIT_SIZE_LINES = 200`.
