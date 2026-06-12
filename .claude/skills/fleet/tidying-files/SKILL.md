---
name: tidying-files
description: Sweeps every fleet repo for never-wanted junk (.DS_Store, Thumbs.db, *.orig, *.rej, *.swp, *.pyc, __pycache__) and stray AI/temp scratch (orphaned /tmp cascade dirs, dry-run logs), deleting only untracked-or-ignored paths — never a git-tracked file, never anything inside a submodule. Conservative and no-prompt: dry-run by default, /loop-able. Use for periodic low-friction cleanup of accreted junk across the fleet, or before a commit/cascade.
user-invocable: true
allowed-tools: Bash(node:*), Bash(git:*), Read
model: claude-haiku-4-5
context: fork
---

# tidying-files

OS cruft (`.DS_Store`), editor backups (`*.orig`, `*.swp`, `*~`), build stragglers
(`*.pyc`, `__pycache__`), and stray AI/temp scratch (orphaned `/tmp/cascade-*` dirs, dry-run
logs) accrete across the fleet. This is the conservative, no-prompt sweep that clears them —
the `tidying-*` family member for junk files. It deletes ONLY paths git doesn't track and that
don't live in a submodule, so it can never remove real work.

## When to use

- **Periodic cleanup** — run on a `/loop` so junk never accumulates.
- **Before a commit or cascade** — clear OS cruft that would otherwise ride along.
- **After a long session** — sweep the `/tmp` scratch the fleet's own tooling leaves behind.

## Run it

```bash
# Dry-run (default): report what WOULD be deleted, delete nothing.
node .claude/skills/fleet/tidying-files/lib/tidy-files.mts

# Act: delete the junk fleet-wide.
node .claude/skills/fleet/tidying-files/lib/tidy-files.mts --fix

# One repo.
node .claude/skills/fleet/tidying-files/lib/tidy-files.mts --fix --repo socket-cli
```

Reads the canonical roster from `cascading-fleet/lib/fleet-repos.txt`; resolves repos under
`$PROJECTS` (default `~/projects`).

## Periodic, no-prompt operation

```
/loop 6h /fleet:tidying-files --fix
```

Safe unattended: the deletion is gated to never-wanted patterns AND a per-path
git-safe check, so a `--fix` run can only ever remove junk.

## What it deletes (and what it never touches)

- **Junk basenames**: `.DS_Store` (+ variants), `Thumbs.db`, `Desktop.ini`, `*.orig`, `*.rej`,
  `*.swp`/`*.swo`, `*~`, `*.pyc`, `__pycache__/`.
- **Stray tmp scratch** (outside any repo): orphaned `/tmp/cascade-*` dirs + dry-run logs.
- **Never**: a git-tracked file (a tracked file matching a junk pattern is a deliberate
  fixture), or anything inside a submodule (it belongs to the submodule's own git — deleting
  it would dirty the submodule). Each candidate is checked via `isUntrackedNonSubmodulePath`
  before removal; deletion uses `safeDelete` from `@socketsecurity/lib/fs/safe`.

## Relationship to sweep-ds-store

The `sweep-ds-store` Stop hook removes only `.DS_Store`, at edit time, in the current repo.
This skill is the fleet-wide, multi-pattern, periodic complement.

## Conservative contract

- Dry-run by default; `--fix` opts into deletion.
- Deletes only untracked-or-ignored paths, never tracked files, never submodule-internal paths.
- No prompting — the safety is in the predicate, not a confirmation step.
