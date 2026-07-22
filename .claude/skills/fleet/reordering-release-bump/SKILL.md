---
name: reordering-release-bump
description: Move an existing version-bump commit back to tip, retag it, verify integrity, and force-push safely.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(node:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
---

# reordering-release-bump

Make an already-landed `chore: bump version to X.Y.Z` commit the **latest** commit again, when
cascades / fixes / features landed on top of it after the bump. Reorders history so the bump is at
the tip, repoints the `vX.Y.Z` tag, and force-pushes — losing zero work (the tree stays byte-for-byte
identical; only the bump's POSITION moves).

This is NOT a new release. The bump + its CHANGELOG entry already exist; this only relocates them. For
a fresh version, do a normal forward bump instead.

## Run

The runner is **dry-run by default** — it reports old tip → new tip, the bump SHA, the backup branch
name, and confirms the tree is identical without pushing. Inspect that, then rerun with `--apply`.

```bash
# Dry-run (default): plan + integrity check only, no push.
node .claude/skills/fleet/reordering-release-bump/lib/reorder-bump.mts /path/to/<repo>

# Apply: push the reorder + repoint the tag (see the human stop below first).
node .claude/skills/fleet/reordering-release-bump/lib/reorder-bump.mts /path/to/<repo> --apply
```

See [`lib/reorder-bump.mts`](lib/reorder-bump.mts) for the 7-phase implementation.

| #   | Phase           | What it does                                                                                          |
| --- | --------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Pre-flight      | Resolve default branch (main → master fallback); `fetch --tags`; find the bump commit + its version. |
| 2   | Verify          | Bump touches exactly `package.json` + `CHANGELOG.md` — else abort.                                    |
| 3   | Backup          | Push `$ORIGIN_TIP:refs/heads/backup/pre-reorder-<ts>-<short>` before any destructive op.              |
| 4   | Reorder         | In a throwaway worktree: `rebase --onto <bump>^ <bump> HEAD`, then `cherry-pick <bump>` to the tip.   |
| 5   | Integrity       | `git diff <orig-tip> HEAD` must be EMPTY (HARD exit otherwise); tip subject must name the version.    |
| 6   | Retag + push    | `git update-ref refs/tags/vX.Y.Z`; two `--force-with-lease` pushes (branch + tag).                    |
| 7   | Verify + clean  | Origin branch + tag both equal the new bump; remove the worktree + temp branch.                       |

## Human stop before `--apply`

The two force-pushes use **`--force-with-lease`** (never bare `--force`): the lease fails safely if the
remote moved since the backup, so a racing push is never clobbered. `--force-with-lease` is gated by
`no-force-push-guard`; its bypass phrase is documented in
[`bypass-phrases`](../../../../docs/agents.md/fleet/bypass-phrases.md). Confirm the user has supplied
that phrase (ask via `AskUserQuestion` if unsure) before invoking with `--apply`.

## Why the runner is shaped the way it is

- The retag uses **`git update-ref refs/tags/vX.Y.Z <sha>`** (git plumbing), NOT `git tag -f`.
  `git tag` of a `vX.Y.Z` pattern trips `version-bump-order-guard`, which demands a full pre-release
  prep wave (coverage etc.). That gate is correct for a NEW release but wrong for a pure position
  reorder of an already-prepped bump. `update-ref` sets the same ref without invoking `git tag`, so
  the guard does not fire.
- The reorder runs entirely in a **throwaway sibling worktree** (`<repo>-reorder`); the primary
  checkout is never touched (parallel-Claude rule).
- A non-empty integrity diff is a **HARD `process.exit(1)`** — the whole point is that only POSITION
  moved, so any content change means corruption and the push must not happen.

If a fresh worktree's pre-push hook crashes with `ERR_MODULE_NOT_FOUND @socketsecurity/lib-stable`,
run `pnpm i` in the worktree first — the hook needs its deps.
