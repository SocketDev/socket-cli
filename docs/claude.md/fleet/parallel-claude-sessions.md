# Parallel Claude sessions

Companion to the `### Parallel Claude sessions` rule in `template/CLAUDE.md`. The inline section gives the headline plus the worktree recipe. This file holds the full prohibition list, the worktree recipe broken down, and the umbrella rule.

## The problem

A single socket-\* checkout often has multiple Claude sessions running concurrently: parallel agents, parallel terminals, or git worktrees mapped onto the same `.git/`. Your session is not the only writer. Several common git operations assume otherwise.

## Forbidden in the primary checkout

These commands mutate state that belongs to other sessions:

- **`git stash`**. The stash is a shared store. Another session can `git stash pop` yours.
- **`git add -A` / `git add .`**. Sweeps in files that belong to another session's in-progress work. The `overeager-staging-guard` hook blocks these in real time (bypass: `Allow add-all bypass`).
- **`git checkout <branch>` / `git switch <branch>`**. Yanks the working tree out from under another session editing a file on the current branch.
- **`git reset --hard` against a non-HEAD ref**. Discards another session's commits.

If a hook flags one of these, the hook is doing its job. Don't bypass.

## Required for branch work: spawn a worktree

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
       | sed 's@^refs/remotes/origin/@@' || echo main)
git worktree add -b <task-branch> ../<repo>-<task> "$BASE"
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

The `BASE` lookup resolves the remote's default branch. Usually `main`, but legacy repos still use `master`. Never hard-code one; see [Default branch fallback](../../../CLAUDE.md#default-branch-fallback).

After `git worktree remove`, the branch lives in the primary repo's `.git/refs/heads/`. Push it from there if you still need it.

## Required for staging: surgical adds

`git add <specific-file>`. Never `-A` / `.`. The `overeager-staging-guard` hook enforces this at edit time.

## Never revert files you didn't touch

`git status` shows unfamiliar changes? Leave them. They belong to:

- Another concurrent session
- An upstream pull that's still settling
- A hook side-effect (formatter, linter, sync-scaffolding)

`git checkout -- <file>` against work you didn't produce destroys the other session's progress.

## Never reach into a sibling fleet repo's path

Cross-repo imports go through `@socketsecurity/lib/...` and `@socketregistry/...` (workspace exports). Path-based imports (`../<sibling-repo>/...`) break in CI, in fresh clones, and on CI agents without the sibling checked out. The `cross-repo-guard` hook blocks these at edit time.

## Never overwrite a file another session is editing

A plain `Edit` / `Write` to a file another session has dirty silently clobbers their uncommitted work — and they may clobber yours right back, edit-for-edit, until one of you stops. (Incident 2026-05-27: two Claude sessions plus a Codex companion shared one checkout; one kept re-cascading `shell-command.mts` + test files, reverting the other's type-error fixes four times.) The `parallel-agent-edit-guard` hook blocks an Edit/Write/NotebookEdit whose target is **foreign** — dirty, not authored by this session, changed within 30 min — so the clobber is refused before it lands. Companion to `parallel-agent-staging-guard` (git-op version) + `parallel-agent-on-stop-reminder` (turn-end signal); all share `_shared/foreign-paths.mts`. When it fires: let the other session commit first, work on a different file, or use a `git worktree` for an isolated edit. Bypass (only if the other edit is abandoned): `Allow parallel-agent-edit bypass`.

## The umbrella rule

> Never run a git command that mutates state belonging to a path other than the file you just edited.

Stash, add-all, checkout-branch, reset-hard, and revert-other-session's-file are the common shapes. The rule is general. If you can't explain why the command only affects files your session owns, don't run it.
