---
name: squashing-history
description: Squashes all commits on the repo's default branch (main, falling back to master) to a single conventional-commit "chore: initial commit" with backup branch, integrity verification, and user confirmation before force push. Use when cleaning history or preparing for fresh start.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(git:*), Bash(diff:*), Bash(rm:*), Bash(ls:*)
model: claude-haiku-4-5
context: fork
---

# squashing-history

Squash all commits on the default branch to a single commit while preserving code integrity.

The commit message is **`chore: initial commit`** — a Conventional Commits header, so it clears `commit-message-format-guard`. Both the collapse commit and the force push trip `no-revert-guard` (`--no-verify` / `--force*`), so the squash commands carry an inline **`SQUASH_HISTORY=1`** sentinel that scopes the bypass to exactly those two operations (the same opt-in-per-command shape as the cascade's `FLEET_SYNC=1`). The sentinel is honored only for a single, un-chained `git commit --amend -m "chore: initial commit"` or `git push --force*` — anything else falls through to the normal block.

## Process

### Phase 1: Pre-flight

Resolve the default branch (per the fleet's _Default branch fallback_ rule — prefer `main`, fall back to `master`), then verify the working directory is clean and the current branch matches. Do not proceed otherwise.

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main && BASE=main
[ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master && BASE=master
BASE="${BASE:-main}"

git status
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$BASE" ]; then
  echo "Refusing to squash: current branch '$CURRENT' is not the default branch '$BASE'"
  exit 1
fi
```

If local is behind `origin/$BASE` (a clean working tree that can fast-forward), sync first — `git merge --ff-only origin/$BASE` — so the squash captures the full remote history instead of dropping commits the force push would then overwrite.

### Phase 2: Create Backup

```bash
BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
```

Verify backup branch exists and points to current HEAD.

### Phase 3: Capture Baseline

Record original HEAD SHA and commit count for reporting.

### Phase 4: Squash

Soft-reset onto the root commit (this keeps the root, leaving every change staged on top of it), then **amend the root** so the result is a single commit — not root + 1. The `SQUASH_HISTORY=1` sentinel clears the `--no-verify` block; the tree is verified identical to the backup in Phase 5, so the hook chain has nothing new to check.

```bash
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
git reset --soft "$FIRST_COMMIT"
SQUASH_HISTORY=1 git commit --amend --no-verify -m "chore: initial commit"
```

Verify commit count is exactly 1:

```bash
test "$(git rev-list --count HEAD)" -eq 1 || echo "Expected 1 commit, got $(git rev-list --count HEAD)"
```

A plain `git reset --soft "$FIRST_COMMIT"` followed by a fresh `git commit` leaves **two** commits (the original root plus the new one). Amending the root is what collapses to one.

### Phase 5: Verify Integrity

```bash
git diff --ignore-submodules "$BACKUP_BRANCH"
```

Output must be completely empty. If any differences appear, rollback immediately with `git reset --hard $BACKUP_BRANCH`.

### Phase 6: Confirm with User

Show summary (original count, backup branch name, integrity status) and ask for explicit confirmation via AskUserQuestion before force push.

### Phase 7: Force Push

Use `--force-with-lease` (aborts if the remote moved since the last fetch) rather than bare `--force`. The `SQUASH_HISTORY=1` sentinel clears the `no-revert-guard` force-push block for this one command.

```bash
SQUASH_HISTORY=1 git push --force-with-lease origin "$BASE"
```

Verify local and remote SHAs match after push.

### Phase 8: Report

Report completion with backup branch name and rollback instructions.

See `reference.md` for retry loops and edge case handling.

## Staying at one commit after a cascade

Once a repo is a single `chore: initial commit`, the wheelhouse cascade keeps it that way: `sync-scaffolding` detects the lone-initial-commit shape (`isSingleInitialCommit` in `scripts/repo/sync-scaffolding/commit.mts`) and **amends** the cascade into that commit (`git commit --amend --no-edit`) rather than stacking a `chore(wheelhouse): cascade …` on top. So a squashed repo doesn't drift back to multi-commit between manual squashes — no re-squash needed after routine cascades.
