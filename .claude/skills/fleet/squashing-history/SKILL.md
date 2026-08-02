---
name: squashing-history
description: Squash default-branch history to one commit with backup and force-push.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(node:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
metadata:
  internal: true
---

# squashing-history

Squash all commits on the default branch to a single commit while preserving code integrity. This is
the low-level squash-to-one-commit primitive; `refreshing-history` layers dep-refresh + a signed
commit on top of the same engine.

The commit message is **`chore: initial commit`** — a Conventional Commits header, so it clears
`commit-message-format-guard`. The collapse is gated by `no-revert-guard` and the force-push by
`no-force-push-guard`; the runner sets an inline **`SQUASH_HISTORY=1`** sentinel limited to exactly
those two commands — the same opt-in-per-command shape as the cascade's `FLEET_SYNC=1`.

## Run

```bash
node .claude/skills/fleet/squashing-history/run.mts /path/to/<repo>
```

The runner walks 8 phases end-to-end in a sibling worktree; the primary checkout is never touched. See
[`run.mts`](run.mts) for the implementation (the shared `squashSingleCommit()` engine lives there and
is reused by `refreshing-history`).

### Feature-branch mode (`--branch`)

```bash
node .claude/skills/fleet/squashing-history/run.mts /path/to/<repo> \
  --branch <name> [--base <ref>] [--message <subject>]
```

This is the **sanctioned path for an author-agreed feature-branch total-squash** — it removes the need
to type `Allow total squash bypass` every time. Instead of the default branch, it collapses the named
feature branch to a single commit **on top of its PR base's merge-base**:

- `--branch <name>` — the feature branch to squash (required for this mode).
- `--base <ref>` — the PR base used for the merge-base (default: the resolved default branch, usually
  `main`). Only commits the branch added past this base are collapsed; the shared base is never
  rewritten.
- `--message <subject>` — the collapsed commit's subject (usually the PR title). When omitted it
  defaults to the branch tip's own subject, falling back to `chore: initial commit`.

It reuses the **same engine and safety contract** as the default-branch flow — resolve the canonical
tip (local-canonical / origin, refusing a two-way divergence), push a byte-verified backup ref of the
pre-squash tip **before** any rewrite, HARD-verify the post-squash tree is byte-identical to that tip,
then `--force-with-lease`-push under the `SQUASH_HISTORY=1` sentinel. Because that backup + tree-identity
check is what the guards trust (not the branch name), the same sentinel clears
`no-total-squash-guard`/`no-force-push-guard` for the feature-branch push **with no bypass phrase** —
the safety is unchanged. Unlike the default-branch flow it skips the roster opt-in / published-release
gates: it rewrites only the named branch, never the repo's published default-branch history.

The runner first resolves the **freeze boundary**: the newest published-release commit (npm
`gitHead` / crates.io `.cargo_vcs_info.json`, ancestor-verified against the tip being squashed). A
repo that has never published (still `0.0.0` on every registry) has no boundary and squashes full-root
as below. A repo with a resolved boundary **always** runs **tail mode**, regardless of the
local-vs-origin relationship — every commit through the boundary stays byte-identical, and only
`boundary..tip` collapses to one fresh commit. See
[`squash-until-release`](../../../../docs/agents.md/fleet/squash-until-release.md).

With no boundary, the runner picks a mode from the local-vs-origin relationship (local main is
canonical in the fleet):

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

**Tail mode** runs whenever a boundary is resolved. It uses the same
worktree/backup/integrity/lease-push shape, with two differences: the reset target is the frozen
boundary rather than the root, so `resetTo: boundary, amend: false` writes a FRESH commit and never
rewrites the release commit, and a runtime `assertBoundaryIntact()`
check after the squash re-verifies the boundary still resolves to itself and is still an ancestor of
the new tip before the push. `[Unreleased]` accrues only `boundary..tip`, never the whole root — the
released commits below the boundary already carry their own version heading in CHANGELOG.md.

## Why the runner is shaped the way it is

- **Amend the root, don't re-commit**: a soft-reset to the root commit followed by a fresh commit
  leaves **two** commits — the original root plus the new one. Amending the root is what collapses to
  one.
- **Integrity is a HARD exit**: the post-squash tree must be byte-identical to the pre-squash backup.
  A non-empty diff means the squash altered content — that is corruption, so the runner exits before
  the push can happen.
- **Lease, not bare force**: the push uses `--force-with-lease`, which aborts if the remote moved
  since the last fetch, so a racing push is never clobbered.

When invoking interactively, show the summary (original count, backup ref, integrity status) and ask
for explicit confirmation via `AskUserQuestion` before the push.

See `reference.md` for retry loops and edge-case handling.

## Other history rewrites

This skill collapses history. For the two other rewrite shapes, the deterministic
owners already exist — never hand-roll one:

- **Strip AI attribution from a range of messages:**
  `node scripts/fleet/strip-ai-attribution.mts --base <ref> [--dry-run]`. It walks
  `base..HEAD` with plumbing, rewords only flagged messages, preserves tree +
  author identity + author date, signs each commit, and verifies the final tree
  byte-identical.
- **Regroup a span into logical commits:** `scripts/fleet/consolidate-commits.mts`.

`history-rewrite-guard` blocks `git filter-branch` / `git filter-repo` / an
unsigned `git commit-tree` — they re-mint commits unsigned, and `filter-branch`
restores the original `GIT_COMMITTER_*`, so even a re-signed commit fails
GitHub's verification. See [`history-rewrites`](../../../../docs/agents.md/fleet/history-rewrites.md).

## Staying at one commit after a cascade

Once a repo is a single `chore: initial commit`, the wheelhouse cascade keeps it that way:
`sync-scaffolding` detects the lone-initial-commit shape (`isSingleInitialCommit` in
`scripts/repo/sync-scaffolding/commit.mts`) and **amends** the cascade into that commit
(`git commit --amend --no-edit`) rather than stacking a `chore(wheelhouse): cascade …` on top. So a
squashed repo doesn't drift back to multi-commit between manual squashes — no re-squash needed after
routine cascades.
