# squashing-history Reference Documentation

## Feature-branch mode (`--branch`)

`node run.mts <repo> --branch <name> [--base <ref>] [--message <subject>]` is the sanctioned path for
an **author-agreed feature-branch total-squash**. It collapses the named branch to one commit on its PR
base's merge-base instead of squashing the default branch, so an agreed squash no longer needs the
`Allow total squash bypass` phrase.

<details>
<summary><b>Flags and safety gates</b>: what `--base` and `--message` default to, the four engine-enforced checks from divergence refusal to the lease push, and the two-command backup recovery</summary>

- **`--base <ref>`** — the PR base for the merge-base. Defaults to the resolved default branch
  (`main` → `master` fallback); pass it when the branch targets a non-default base. Only
  `merge-base..tip` is collapsed — the shared base is never rewritten.
- **`--message <subject>`** — the collapsed commit's subject (usually the PR title). Omit it to default
  to the branch tip's own subject, falling back to `chore: initial commit`.

Safety is identical to the default-branch flow and is enforced by the engine, not the guard:

1. **Divergence refusal** — if local `<name>` and `origin/<name>` each hold commits the other lacks, the
   run refuses (reconcile forward first). Local-ahead is squashed from the local tip; local == origin (or
   no local branch) is squashed from origin's tip.
2. **Backup ref first** — the pre-squash tip is pushed to `refs/heads/backup-YYYYMMDD-HHMMSS` on origin
   before any rewrite.
3. **HARD tree-identity gate** — `squashSingleCommit` `process.exit(1)`s if the collapsed tree differs
   from the pre-squash tip by a single byte.
4. **Lease push under the sentinel** — `SQUASH_HISTORY=1 git push --force-with-lease=<name>:<origin-sha>
   origin HEAD:<name>`. That exact shape (single ref, lease, no multi-ref/delete flags) is what
   `squash-sentinel.mts` authorizes for **any** branch — the guard trusts the byte-verified backup the
   engine already performed, so no bypass phrase is needed.

Recover a feature-branch squash the same way as the default-branch one:

```bash
git fetch origin backup-YYYYMMDD-HHMMSS
git push --force origin FETCH_HEAD:<name>
```

</details>

## Retry Loops

### Phase 2: Backup Branch Creation with Retry

<details>
<summary><b>Backup-branch retry loop</b>: 3 attempts at a `backup-YYYYMMDD-HHMMSS` branch, with a 1-second sleep between timestamp collisions and a listing of every existing backup</summary>

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

</details>

### Phase 8: Force Push with Retry

`$BASE` is the default branch resolved in Phase 1 (never hard-code `main`). The
`SQUASH_HISTORY=1` sentinel clears the `no-force-push-guard` block, and
`--force-with-lease` aborts if the remote moved since the last fetch.

<details>
<summary><b>Force-push retry loop</b>: 3 attempts at `SQUASH_HISTORY=1 git push --force-with-lease origin "$BASE"`, a 2-second delay between tries, and the permissions/branch-protection hint on final failure</summary>

```bash
# Retry force push up to 3 times for transient failures
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Force push attempt $ITERATION/$MAX_ITERATIONS"

  if SQUASH_HISTORY=1 git push --force-with-lease origin "$BASE"; then
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

</details>

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

`run.mts` refuses to squash a dirty tree up front (`checkTreeIsClean`,
exit 2). A squash collapses COMMITTED history, so anything living only in
the working tree is excluded from the collapse and left stranded on top of
rewritten history — where this flow's own recovery step
(`git reset --hard <newHead>`) destroys it.

Land the dirty files FIRST, then squash — never the reverse. Commit with an
explicit pathspec; do NOT use `git add -A` (sweeps files belonging to
parallel Claude sessions) or `git stash` (a shared store other sessions can
clobber on pop).

```bash
git status
git add -- <your-paths>
git commit -m "chore: land before squash"
```

Do not stash, do not branch, do not retreat into a private worktree, and do
not wait for a quiet window. History flattens at the collapse anyway, so any
subject will do, and a long-held tree is the hazard rather than the remedy.
See `docs/agents.md/fleet/parallel-claude-sessions.md` ("Land the dirty files
BEFORE squashing").

Ignored files never block: the guard reads `git status --porcelain` without
`--ignored`, so a dirty `dist/` or `node_modules/` is invisible to it.

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
2. **The `fleet-main-protection` ruleset:** every fleet repo blocks
   `non_fast_forward` on the default branch with zero bypass actors, so GitHub
   rejects the push after the local guards have already passed. Read the
   current actors, take a temporary self-exemption, push, then hand it back:

   ```bash
   node scripts/fleet/grant-ruleset-bypass.mts <repo>
   node scripts/fleet/grant-ruleset-bypass.mts <repo> --grant --yes
   # re-run the push, then:
   node scripts/fleet/grant-ruleset-bypass.mts <repo> --revoke
   ```

   Never patch the ruleset by hand — a full-body `gh api` write drops the rules
   it omits. The grant is self-expiring: the next
   `main-branch-rules-are-enforced --fix` removes it.
3. **No remote tracking:** Add with `SQUASH_HISTORY=1 git push --set-upstream --force-with-lease origin "$BASE"`

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
