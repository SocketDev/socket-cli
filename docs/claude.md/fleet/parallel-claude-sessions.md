# Parallel Claude sessions

Companion to the `### Parallel Claude sessions` rule in `template/CLAUDE.md`.
The inline section gives the headline + worktree recipe; this file is the
full prohibition list, the worktree recipe broken down, and the umbrella
rule.

## The problem

A single socket-* checkout may have multiple Claude sessions running
concurrently — driven by parallel agents, parallel terminals, or git
worktrees mapped onto the same `.git/`. The session you're in **is not
the only writer**. Several common git operations are hostile to that.

## Forbidden in the primary checkout

These commands mutate state that belongs to other sessions:

- **`git stash`** — the stash is a shared store. Another session can
  `git stash pop` yours.
- **`git add -A` / `git add .`** — sweeps in files that belong to
  another session's in-progress work. The `overeager-staging-guard`
  hook blocks these in real time (bypass: `Allow add-all bypass`).
- **`git checkout <branch>` / `git switch <branch>`** — yanks the
  working tree out from under another session that was editing a file
  on the current branch.
- **`git reset --hard` against a non-HEAD ref** — discards another
  session's commits.

If a hook ever flags one of these, that's the hook doing its job —
not a false positive to bypass.

## Required for branch work: spawn a worktree

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
       | sed 's@^refs/remotes/origin/@@' || echo main)
git worktree add -b <task-branch> ../<repo>-<task> "$BASE"
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

The `BASE` lookup resolves the remote's default branch — usually `main`,
but legacy repos still use `master`. Never hard-code one; see
[Default branch fallback](../../../CLAUDE.md#default-branch-fallback).

After the worktree is removed, the branch lives in the primary repo's
`.git/refs/heads/`; push it from there if it's still needed.

## Required for staging: surgical adds

`git add <specific-file>`. Never `-A` / `.`. The `overeager-staging-guard`
hook enforces this at edit time.

## Never revert files you didn't touch

If `git status` shows unfamiliar changes, leave them. They belong to:

- Another concurrent session
- An upstream pull that's still settling
- A hook side-effect (formatter, linter, sync-scaffolding)

`git checkout -- <file>` against work you didn't produce destroys the
other session's progress.

## Never reach into a sibling fleet repo's path

Cross-repo imports go through `@socketsecurity/lib/...` and
`@socketregistry/...` (workspace exports). Path-based imports
(`../<sibling-repo>/...`) break in CI, fresh clones, and CI agents
that don't have the sibling checked out. The `cross-repo-guard` hook
blocks these at edit time.

## The umbrella rule

> Never run a git command that mutates state belonging to a path other
> than the file you just edited.

Stash, add-all, checkout-branch, reset-hard, and revert-other-session's-file
are the common shapes — but the rule is the general one. If you can't
explain why the command only affects files your session owns, don't run
it.
