# pre-commit-race-nudge

PreToolUse (Bash) hook that nudges away from reflexive `git commit --no-verify` when the real cause is a parallel session racing the shared `.git/` index.

## Why

When a sibling worktree session's pre-commit keeps racing the shared `.git/` index on a dangling object, the failure is reproducible but it isn't the agent's own change — so reflexive `--no-verify` is the wrong reflex. Even with each tree verified green independently before bypassing, `--no-verify` skips **all** validation, so a genuine problem in the agent's own change would slip through the same gap. An index race is recoverable by retrying (the lock clears when the other session's git op finishes) or by committing from an isolated `GIT_INDEX_FILE`. Disabling the gate is the wrong tool.

Per CLAUDE.md "Parallel Claude sessions."

## What it does

On a Bash `git commit … --no-verify` (or `-n`) that is **not** a `FLEET_SYNC=1` cascade commit, prints guidance to stderr:

1. Retry the commit — the lock clears when the other git op ends.
2. Or commit from an isolated index (`GIT_INDEX_FILE=$(mktemp) …`).
3. Reserve `--no-verify` for a genuinely broken pre-commit, tree verified green independently.

It's a **reminder** (exit 0), not a block — `--no-verify` is already gated behind the `Allow no-verify bypass` phrase by `no-revert-guard`. This hook only steers the recovery when that bypass is in play. Cascade commits (`FLEET_SYNC=1`) are exempt.

## Bypass

No bypass — it's a reminder (exit 0), not a block. The `--no-verify` it
steers is itself gated behind the `Allow no-verify bypass` phrase by
`no-revert-guard`.
