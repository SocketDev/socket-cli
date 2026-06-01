# squashing-history Reference Documentation

## Retry Loops

### Phase 2: Backup Branch Creation with Retry

```bash
# Retry backup branch creation up to 3 times for timestamp collisions
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Backup branch creation attempt $ITERATION/$MAX_ITERATIONS"

  # Create backup branch with timestamp and store name
  BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"

  # Check if branch already exists (timestamp collision)
  if git rev-parse --verify "$BACKUP_BRANCH" >/dev/null 2>&1; then
    echo "⚠ Branch $BACKUP_BRANCH already exists (timestamp collision)"

    if [ $ITERATION -eq $MAX_ITERATIONS ]; then
      echo "✗ Failed to create unique backup branch after $MAX_ITERATIONS attempts"
      exit 1
    fi

    sleep 1  # Wait to get different timestamp
    ITERATION=$((ITERATION + 1))
    continue
  fi

  # Create the branch
  if git branch "$BACKUP_BRANCH"; then
    echo "✓ Backup branch created: $BACKUP_BRANCH"
    break
  fi

  echo "⚠ Branch creation failed (Iteration $ITERATION/$MAX_ITERATIONS)"

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Failed to create backup branch after $MAX_ITERATIONS attempts"
    exit 1
  fi

  sleep 1
  ITERATION=$((ITERATION + 1))
done

# Show all backup branches
git branch | grep backup-
```

### Phase 8: Force Push with Retry

```bash
# Retry force push up to 3 times for transient failures
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Force push attempt $ITERATION/$MAX_ITERATIONS"

  if git push --force origin main; then
    echo "✓ Force push succeeded"
    break
  fi

  echo "⚠ Force push failed (Iteration $ITERATION/$MAX_ITERATIONS)"

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Force push failed after $MAX_ITERATIONS attempts"
    echo "Check remote permissions, URL, or branch protection rules"
    exit 1
  fi

  sleep 2  # Brief delay before retry
  ITERATION=$((ITERATION + 1))
done
```

## Code Integrity Verification

### Phase 6: Detailed Difference Checking

```bash
# Compare current code with backup branch
# Ignore submodules and generated documentation
git diff --ignore-submodules "$BACKUP_BRANCH"
```

**Note:** This check ignores:

- Submodule internal states (dirty states, uncommitted changes)
- Submodule pointer changes are still detected

**Alternative: Stricter checking (only specific paths):**

```bash
# Only check source code and critical config
git diff "$BACKUP_BRANCH" -- src/ bin/ test/ package.json pnpm-lock.yaml tsconfig.json
```

### Handling Differences

**If differences found:**

1. Review differences:
   ```bash
   git diff --ignore-submodules "$BACKUP_BRANCH" --stat
   git diff --ignore-submodules "$BACKUP_BRANCH"
   ```
2. If differences are NOT acceptable (actual code changes):
   ```bash
   echo "✗ Code differences detected! Aborting squash."
   git reset --hard "$BACKUP_BRANCH"
   echo "✓ Restored to backup branch: $BACKUP_BRANCH"
   exit 1
   ```
3. If differences are acceptable (metadata, timestamps in docs):
   - Document the differences
   - Proceed to Phase 7

## Rollback Procedures

### Phase 7: User Declines Rollback

```bash
# Rollback to backup
git reset --hard "$BACKUP_BRANCH"
echo "Rollback complete. You are back to original state."
```

### Emergency Rollback (Lost Variable)

```bash
# Reset to backup using stored variable
git reset --hard "$BACKUP_BRANCH"
echo "✓ Restored to backup: $BACKUP_BRANCH"

# If you lost the variable, find the branch:
git branch | grep backup-
# Then: git reset --hard <backup-branch-name>
```

## Edge Cases

### Uncommitted Changes

```bash
git status
```

If dirty, handle the changes safely. Do NOT use `git add -A` (sweeps
files belonging to parallel Claude sessions) or `git stash` (uses a
shared stash store that other sessions can clobber on pop).

Pick one:

- Commit on a WIP branch with surgical adds:

  ```bash
  git checkout -b wip/before-squash
  git add <specific-files>
  git commit -m "wip: before squash"
  git checkout main
  ```

- OR run the squash in an isolated worktree, leaving this checkout
  alone:

  ```bash
  git worktree add ../<repo>-squash main
  cd ../<repo>-squash
  # ... run the squash from Phase 1 …
  # When the squash is fully pushed, retire the worktree:
  cd <primary-checkout>
  git worktree remove ../<repo>-squash
  ```

  Worktrees that don't get retired pile up under `~/projects/`.
  Always close the loop.

Then retry from Phase 1.

### Not on Main Branch

```bash
git checkout main
# Then retry from Phase 1
```

### Code Differences Detected

If differences found in Phase 6 that are NOT acceptable:

```bash
# Reset to backup using stored variable
git reset --hard "$BACKUP_BRANCH"
echo "✓ Restored to backup: $BACKUP_BRANCH"

# If you lost the variable, find the branch:
git branch | grep backup-
# Then: git reset --hard <backup-branch-name>
```

### Force Push Fails

Common causes:

1. **No remote access:** Check remote URL: `git remote -v`
2. **Branch protection:** Check GitHub/GitLab branch protection rules
3. **No remote tracking:** Add with `git push --set-upstream origin main --force`

Recovery:

```bash
# You're still on local main with squashed commit
# Backup is safe on local branch
git reset --hard "$BACKUP_BRANCH"
```

### Already Squashed

```bash
CURRENT_COUNT=$(git rev-list --count HEAD)
if [ "$CURRENT_COUNT" -eq 1 ]; then
  echo "Already squashed to 1 commit. Exiting."
  exit 0
fi
```

### Backup Branch Already Exists

```bash
# Check before creating
if git rev-parse --verify "backup-$(date +%Y%m%d-%H%M%S)" >/dev/null 2>&1; then
  echo "⚠ Backup branch with this timestamp already exists"
  # Wait 1 second to get different timestamp
  sleep 1
  BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
fi
```

## Variables Used

### Phase-by-Phase Variable Tracking

- `$BACKUP_BRANCH` - Name of backup branch (set in Phase 2, used in Phases 6-9)
- `$ORIGINAL_HEAD` - Original HEAD commit hash (Phase 3)
- `$ORIGINAL_COUNT` - Original commit count (Phase 3)
- `$FIRST_COMMIT` - First commit hash (Phase 4)

### Variable Scope

All variables are set in bash and persist across phases within the same bash session. Variables are lost if bash session ends, so critical variables like `$BACKUP_BRANCH` must be captured early and referenced by name if needed for recovery.
