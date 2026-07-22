# no-pr-from-default-branch-guard

PreToolUse Bash hook (blocking, exit 2) that HARD-BLOCKS `gh pr create` /
`gh pr new` when the PR's head branch is the repository's default branch
(`main` / `master` / the resolved `origin/HEAD` default).

## What it catches

- `gh pr create` while the current checkout is on the default branch (no
  `--head` flag → head is the current branch).
- `gh pr create --head <owner>:main` / `-H master` — an explicit head that names
  the default branch (owner prefix is stripped before the check).
- A literal `main` / `master` head regardless of what `origin/HEAD` points at.

The PR head is resolved structurally: an explicit `--head` / `-H` value wins,
otherwise the current git branch (`git-branch.mts`'s shared resolver). Detection
is **AST-based** — the shell-quote-backed `shell-command.mts` parser, not regex —
so `&&` chains, quoting, `$(…)` substitution, and a literal `"gh pr create"`
inside a `grep` string are all handled correctly.

## Why

Opening a PR whose head is the default branch is a hard error — a PR compares a
head branch against a base, and a head of `main`/`master` is never what you
want. You PR from a feature branch. This is the blocking twin of the advisory
`pr-vs-push-default-nudge` (which reminds you a direct push may be better).

## Universal

Fires in NON-fleet repos too — the motivating incident was a PR opened against
an external repo. It is not gated on fleet membership.

## Skipped scenarios

- `gh pr create --head <owner>:feature-x` — a feature-branch head (allowed).
- The current branch is a feature branch and no `--head` is given (allowed).
- Any non-`gh` Bash command, or a `gh` subcommand other than `pr create`/`pr new`.
- The branch / default cannot be resolved (fails open, no block).

## Bypass

Type `Allow pr-from-default-branch bypass` in a recent message.

## Exit codes

- `2` — blocked: the PR head is the default branch.
- `0` — allowed (head is a feature branch, not a `gh pr create`, unresolvable
  state, or the bypass phrase is present).
