# no-branch-reuse-nudge

PreToolUse Bash hook (reminder, NOT a block) that fires on `git commit`
when the current branch already has upstream history — meaning the agent
is committing onto a shared/existing branch rather than cutting a fresh
one for the current logical change.

## Why

Reusing a branch mixes unrelated commits into one PR, complicates code
review, and causes rebase pain when the branch is already on the remote.
The shape this rule prevents: a session cuts a `feat/<name>` branch
because it assumes a PR workflow, then has to work around the
feature-branch instead of pushing straight to main. The correct move
was `git push origin feat/<name>:main` — which would have been obvious
if the branch hadn't been created at all.

## When it fires

On `git commit` (not `--amend`) when:

- The current branch is NOT the default (`main`/`master`), AND
- The branch already has an upstream tracking ref with commits.

A branch with no upstream (freshly cut this session) is never flagged.

## Suggested actions

- If the change belongs on main: `git push origin <branch>:<default>`
- If a fresh branch is needed: `git checkout -b <fresh-name>`

## Bypass

Type `Allow branch-reuse bypass` in a recent message to proceed.

## Cross-fleet sync

Lives in `socket-wheelhouse/template/.claude/hooks/fleet/` and is
byte-identical across every fleet repo.
