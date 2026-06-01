---
name: squashing-history
description: Squashes all commits on the repo's default branch (main, falling back to master) to a single "Initial commit" with backup branch, integrity verification, and user confirmation before force push. Use when cleaning history or preparing for fresh start.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(git:*), Bash(diff:*), Bash(rm:*), Bash(ls:*)
model: claude-haiku-4-5
context: fork
---

# squashing-history

Squash all commits on the default branch to a single "Initial commit" while preserving code integrity.

## Process

### Phase 1: Pre-flight

Resolve the default branch (per the fleet's _Default branch fallback_ rule — prefer `main`, fall back to `master`), then verify the working directory is clean and the current branch matches. Do not proceed otherwise.

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main;   then BASE=main;   fi
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then BASE=master; fi
BASE="${BASE:-main}"

git status
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$BASE" ]; then
  echo "Refusing to squash: current branch '$CURRENT' is not the default branch '$BASE'"
  exit 1
fi
```

### Phase 2: Create Backup

```bash
BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
```

Verify backup branch exists and points to current HEAD.

### Phase 3: Capture Baseline

Record original HEAD SHA and commit count for reporting.

### Phase 4: Squash

```bash
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
git reset --soft "$FIRST_COMMIT"
git commit -m "Initial commit"
```

Verify commit count is exactly 1.

### Phase 5: Verify Integrity

```bash
git diff --ignore-submodules "$BACKUP_BRANCH"
```

Output must be completely empty. If any differences appear, rollback immediately with `git reset --hard $BACKUP_BRANCH`.

### Phase 6: Confirm with User

Show summary (original count, backup branch name, integrity status) and ask for explicit confirmation via AskUserQuestion before force push.

### Phase 7: Force Push

```bash
git push --force origin "$BASE"
```

Verify local and remote SHAs match after push.

### Phase 8: Report

Report completion with backup branch name and rollback instructions.

See `reference.md` for retry loops and edge case handling.
