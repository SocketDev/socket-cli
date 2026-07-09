---
name: consolidating-commits
description: Regroup the commits since the previous bump (or a given base) into logical commits — one per concern, bump kept last — via scripts/fleet/consolidate-commits.mts. "Consolidate commits" never means squash-to-one; that is squashing-history.
model: haiku
---

# Consolidating commits

When the user says **"consolidate commits"** they mean: regroup the work since
a base ref into LOGICAL commits (one per concern, the auto-lander's grouping),
with a trailing `chore: bump version to X.Y.Z` commit preserved last. They do
NOT mean squashing to a single commit (`squashing-history` owns that).

## Run

```bash
# Preview the grouping (always start here).
node scripts/fleet/consolidate-commits.mts --dry-run

# Rewrite: defaults the base to the previous bump commit (else latest tag).
node scripts/fleet/consolidate-commits.mts

# Explicit base.
node scripts/fleet/consolidate-commits.mts --base v6.0.9
```

The script refuses a dirty worktree (land dirty files first:
`node scripts/fleet/land-work.mts --commit`), verifies the final tree is
byte-identical to the original tip, and hard-restores the original history on
any failure. It never pushes: a rewritten branch needs a separately authorized
lease force-push.

## Contract

- Grouping engine is shared with the auto-lander (`land-work.mts`
  `groupPaths`/`commitMessage`) — one source of truth for what "logical"
  means.
- Bump-last invariant: a `chore: bump version to …` tip is peeled before
  grouping and cherry-picked back as the final commit.
- Nothing is ever lost: byte-identical tree or full restore, no third state.
