# sweep-ds-store

Stop hook that sweeps `.DS_Store` files at turn-end. Excludes `.git/`
and `node_modules/`. Silent on the happy path; logs sweep count when
files are found.

## Why

`.DS_Store` is gitignored fleet-wide, but the files still exist on
disk. They surface in:

- `find` output, polluting search results
- `git status --ignored` reports
- non-git tooling (rsync, tar, zip artifacts)
- Spotlight indexing churn

The right fix is to delete them, not just ignore them. The hook runs
at every turn-end — the same time `stale-process-sweeper` runs — so
files Finder created mid-session are gone before the next turn.

## Behavior

- Walks the worktree starting at `$CLAUDE_PROJECT_DIR` (or `cwd` as
  fallback)
- Skips `.git/` and `node_modules/` subtrees
- Doesn't follow symlinks
- Max depth: 12 (defense against pathological symlink loops)
- Per-file delete errors are logged but never block the hook

## Output

Silent unless files were found. Output goes to stderr:

```
[sweep-ds-store] swept 3 .DS_Store file(s):
  .DS_Store
  src/.DS_Store
  test/fixtures/.DS_Store
```

## Bypass

None — `.DS_Store` is never wanted in a repo. If you have a reason
to keep one (very rare; testing macOS-specific tooling), name it
`.DS_Store.fixture` and adjust the test.
