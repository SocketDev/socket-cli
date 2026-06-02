# commit-cadence-reminder

Stop hook that reinforces the CLAUDE.md "Small commits as you go; gate the merge" rule — **only inside a `git worktree`**.

## What it catches

At turn-end, in a linked worktree:

- **Uncommitted changes** → reminds to commit the logical step now (small commits as you go; `--no-verify` is fine in a worktree).
- **Commits ahead of the target branch** → surfaces the pre-merge gate: `pnpm run fix --all`, `pnpm run check --all`, `pnpm run test` must all pass before landing.

## Why

The worktree is scratch space — committing each step keeps work landable and rebases cheap, and the heavy gate runs once before merge rather than on every commit. Merging a worktree branch before the gate is green is how broken/unformatted/red changes reach the target branch. A reminder (not a block) because Stop hooks fire after the turn.

Stays quiet in the primary checkout — `dirty-worktree-on-stop-reminder` and `commit-pr-reminder` cover that case; this hook avoids double-nagging.

## Bypass

- `SOCKET_COMMIT_CADENCE_REMINDER_DISABLED=1`.

## Test

```sh
pnpm test
```
