# no-primary-branch-switch

Blocks a git command that would change the branch of a **primary** working
tree.

Branch-specific work belongs in a `git worktree`, leaving the primary checkout
on whatever branch it is already on. Note: that covers committing, rebasing,
squashing, and opening PRs. Primary checkouts are frequently in active use by another parallel
Claude session (uncommitted / staged WIP, cascade commits); switching their
branch out from under that session destroys unsaved work and lands the next
commit on the wrong branch.

## Why it exists

This is the user-global sibling of `primary-checkout-branch-guard`. It is
wired through the wheelhouse dispatcher (`~/.claude/settings.json` →
`wheelhouse-dispatch.mts no-primary-branch-switch`) so it fires from **every**
repo session, any `~/projects/<repo>` primary checkout, not only
fleet-managed ones the per-repo dispatcher covers. It supersedes a hand-placed
standalone hook that lived outside the managed fleet.

## What it catches

A `git` command whose effective working tree is the primary checkout:

- `git checkout <branch>` / `git switch <branch>` — switch existing
- `git checkout -b <name>` / `git switch -c <name>` — create + switch
- `git checkout -` / `git switch -` — previous-branch shorthand (still moves HEAD)

The effective directory honors a leading `cd <dir> &&` and the git op's own
`-C <path>`, so a switch aimed at the primary from a worktree cwd is still
caught.

## What it allows

- File-restore forms: `git checkout -- <path>`, `git checkout .`,
  `git checkout <ref> <path>` (two positional args) — never a branch switch
- Any branch op inside a **linked worktree** — the sanctioned place for branch work
- Anything that is not a git branch-switch

## Classification

A linked worktree's `git rev-parse --git-dir` differs from its
`--git-common-dir`; the primary working tree's are **equal**. Equality is the
primary/worktree test. Any git error → `unknown` → the guard fails **open**.

## Bypass

`Allow branch switch`, typed by the human in a genuine user turn (not the
assistant, not a tool result, not a peer-agent relay).
