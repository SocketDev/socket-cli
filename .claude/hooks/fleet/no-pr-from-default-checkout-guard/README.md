# no-pr-from-default-checkout-guard

PreToolUse Bash hook (blocking, exit 2) that HARD-BLOCKS `gh pr create` /
`gh pr new` when the current working directory's git checkout is sitting on its
default branch (current branch === `main` / `master` / the resolved
`origin/HEAD` default).

## What it catches

- `gh pr create` run from a checkout whose current branch IS the default branch
  — even when `--head <owner>:feature-x` names a feature branch on another repo.

The current branch and default are resolved with `git-branch.mts`'s shared
helpers (`currentBranch` via `git symbolic-ref`, `resolveDefaultBranch` via
`origin/HEAD` → `main` → `master`). Detection of `gh pr create` is **AST-based**
(the shell-quote-backed `shell-command.mts` parser, not regex), so `&&` chains,
quoting, `$(…)` substitution, and a literal `"gh pr create"` inside a `grep`
string are all handled correctly. `gh repo create` does not match (the verb must
be `pr create` / `pr new`).

## Why

Running `gh pr create` from a checkout that is on the default branch is the
exact mistake that causes a thrash — the command operates against the wrong
branch state. You must run it from the feature-branch worktree. This is the
"where it runs from" guard; its sibling `no-pr-from-default-branch-guard` is the
"what the PR head is" guard.

## Universal

Fires in NON-fleet repos too — the motivating incident was a PR opened against
an external repo. It is not gated on fleet membership.

## Skipped scenarios

- The current branch is a feature branch (allowed, regardless of `--head`).
- Any non-`gh` Bash command, or a `gh` subcommand other than `pr create`/`pr new`.
- The current branch / default cannot be resolved (fails open, no block).

## Bypass

Type `Allow pr-from-default-checkout bypass` in a recent message.

## Exit codes

- `2` — blocked: `gh pr create` from a default-branch checkout.
- `0` — allowed (feature-branch checkout, not a `gh pr create`, unresolvable
  state, or the bypass phrase is present).
