---
name: squashing-history
description: Squash default-branch history to one commit with backup and force-push.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(node:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
---

# squashing-history

Squash all commits on the default branch to a single commit while preserving code integrity. This is
the low-level squash-to-one-commit primitive; `refreshing-history` layers dep-refresh + a signed
commit on top of the same engine.

The commit message is **`chore: initial commit`** — a Conventional Commits header, so it clears
`commit-message-format-guard`. The collapse is gated by `no-revert-guard` and the force-push by
`no-force-push-guard`; the runner sets an inline **`SQUASH_HISTORY=1`** sentinel limited to exactly
those two commands (the same opt-in-per-command shape as the cascade's `FLEET_SYNC=1`).

## Run

```bash
node .claude/skills/fleet/squashing-history/run.mts /path/to/<repo>
```

The runner walks 8 phases end-to-end in a sibling worktree; the primary checkout is never touched. See
[`run.mts`](run.mts) for the implementation (the shared `squashSingleCommit()` engine lives there and
is reused by `refreshing-history`).

The runner picks a mode from the local-vs-origin relationship (local main is canonical in the
fleet):

- **Local-canonical mode** (local `$BASE` is AHEAD of origin): backup-push the LOCAL tip, mint a
  signed root from its tree via `git commit-tree` (`mintSquashRoot()` — pure object creation, no
  worktree, the primary checkout's index/worktree are never touched), verify the tree is
  byte-identical, point the local branch at the root, lease-push against origin's tip.
- **Origin mode** (local == origin, or no local branch): the classic worktree flow below.
- **Diverged** (origin holds commits local lacks): REFUSED loudly — reconcile forward (merge origin
  into local) first, then re-run.

| #   | Phase           | What it does (origin mode)                                                                        |
| --- | --------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Pre-flight      | Resolve default branch (main → master fallback); fetch; capture orig HEAD + count.               |
| 2   | Worktree        | Add `chore/squash` worktree at `<repo>-squash` tracking `origin/$BASE`.                           |
| 3   | Backup          | Push `$ORIG_HEAD` to `refs/heads/backup-YYYYMMDD-HHMMSS` before any destructive op.               |
| 4   | Squash          | Soft-reset to the root commit, then amend it; verify commit count == 1.                           |
| 5   | Integrity       | Diff against `$ORIG_HEAD` (ignoring submodules) must be empty (HARD exit otherwise).              |
| 6   | Push            | Lease-push the single commit to `$BASE` under the sentinel.                                       |
| 7   | Cleanup         | Remove worktree + delete the temp branch.                                                         |
| 8   | Report          | Print new SHA + backup ref name + recovery one-liner.                                             |

## Why the runner is shaped the way it is

- **Amend the root, don't re-commit**: a soft-reset to the root commit followed by a fresh commit
  leaves **two** commits (the original root plus the new one). Amending the root is what collapses to
  one.
- **Integrity is a HARD exit**: the post-squash tree must be byte-identical to the pre-squash backup.
  A non-empty diff means the squash altered content — that is corruption, so the runner exits before
  the push can happen.
- **Lease, not bare force**: the push uses `--force-with-lease`, which aborts if the remote moved
  since the last fetch, so a racing push is never clobbered.

When invoking interactively, show the summary (original count, backup ref, integrity status) and ask
for explicit confirmation via `AskUserQuestion` before the push.

See `reference.md` for retry loops and edge-case handling.

## Staying at one commit after a cascade

Once a repo is a single `chore: initial commit`, the wheelhouse cascade keeps it that way:
`sync-scaffolding` detects the lone-initial-commit shape (`isSingleInitialCommit` in
`scripts/repo/sync-scaffolding/commit.mts`) and **amends** the cascade into that commit
(`git commit --amend --no-edit`) rather than stacking a `chore(wheelhouse): cascade …` on top. So a
squashed repo doesn't drift back to multi-commit between manual squashes — no re-squash needed after
routine cascades.
