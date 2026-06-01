---
name: refreshing-history
description: Squashes the repo's default branch (main, falling back to master) to a single signed "Initial commit", refreshes deps + lockfile, runs format / fix / check / type passes, amends results, and force-pushes. Wraps the lower-level `squashing-history` skill with a dep-refresh + integrity check + verified-signature workflow. Use when cutting a fleet-wide history reset or preparing a clean baseline before a major release.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(git:*), Bash(pnpm:*), Bash(diff:*), Bash(ls:*)
model: claude-haiku-4-5
context: fork
---

# refreshing-history

Resets the default branch to a single signed commit, with deps freshly resolved and code freshly formatted. Works entirely in a sibling worktree; pushes a remote backup ref before any destructive action.

## When to use

- Cutting a clean baseline before a major release.
- Coordinated fleet-wide history reset (run per-repo).
- A repo's history is a graveyard of WIP / squash-merge artifacts and the team has agreed to start fresh.

**Not for:** dropping unwanted commits surgically (use `git rebase -i`), or covering up bad PR hygiene.

## Boundary with `squashing-history`

`squashing-history` is the lower-level "squash to 1 commit" primitive. This skill layers on dep refresh + signed commit + integrity check + force-push contract. The org's `required_signatures` branch protection mandates `git commit-tree -S` (the bare config flag is unreliable for plumbing commands).

## Run

```bash
node .claude/skills/refreshing-history/run.mts /path/to/<repo>
```

The runner walks 10 phases end-to-end. See [`run.mts`](run.mts) for the implementation.

| #   | Phase           | What it does                                                                                                        |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Pre-flight      | Resolve default branch (main → master fallback); fetch; capture `ORIG_HEAD` and `ORIG_COUNT`.                       |
| 2   | Worktree        | `git worktree add -b chore/squash-and-refresh ../<repo>-squash origin/$BASE`.                                       |
| 3   | Backup          | Push `$ORIG_HEAD:refs/heads/backup-YYYYMMDD-HHMMSS` before any destructive op.                                      |
| 4   | Squash          | `git commit-tree -S` on `HEAD^{tree}` → reset to that single signed commit. Verify count == 1 and signature == `G`. |
| 5   | Integrity check | `git diff --ignore-submodules $ORIG_HEAD` must be empty. Abort otherwise.                                           |
| 6   | Refresh         | `pnpm run update`, `pnpm install`, `pnpm run fix --all`, `pnpm run check --all`. Soft-warn on failures.             |
| 7   | Amend           | `git add -A && git commit --amend --no-edit --no-verify` if anything moved.                                         |
| 8   | Force-push      | `git push --force --no-verify origin HEAD:$BASE`.                                                                   |
| 9   | Cleanup         | Remove worktree + delete the temp branch.                                                                           |
| 10  | Report          | Print new SHA + backup ref name + recovery one-liner.                                                               |

## Hard requirements

- **Default-branch fallback**: never hard-code `main` or `master`; the runner resolves `$BASE` via `git symbolic-ref refs/remotes/origin/HEAD`.
- **Worktree-only**: the primary checkout is never touched (parallel-Claude rule).
- **Remote backup before destruction**: without it, recovery requires reflog access from the machine that ran the squash.
- **Signed commit**: pass `-S` explicitly to `commit-tree`; the bare config flag is unreliable for plumbing.
- **Integrity check before push**: pre-squash tree must equal post-squash tree (modulo submodules).

## Recovery

If something goes wrong AFTER the force-push, restore from the remote backup:

```bash
cd "$SRC"
git fetch origin "<backup-name>"
git push --force origin "FETCH_HEAD:$BASE"
```

The backup ref persists indefinitely on the remote until manually deleted.

## Cross-fleet orchestration

Run via `socket-wheelhouse/scripts/run-skill-fleet.mts` to dispatch one job per repo in parallel. Useful for refreshing multiple repos in one wave.

## Success criteria

- New default branch is exactly 1 commit, signed.
- Pre-squash and post-squash trees match (modulo dep-refresh / format-fix output).
- Remote backup ref points at the pre-squash SHA.
- Worktree and branch removed; primary checkout untouched.
