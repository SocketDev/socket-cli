# mass-delete-guard

PreToolUse hook. Blocks a `git commit` whose staged tree would delete a catastrophic fraction of the repo — **≥ 50 files**, or **> 75% of the tracked tree**.

## Why

That deletion shape is almost never intentional. It's the fingerprint of a clobbered index: a stray `git read-tree`, a `git commit` fired against a near-empty or foreign index, a leftover rename/test artifact, or a misfired scripted commit. The commit records a tiny tree plus tens of thousands of deletions; once pushed, recovery is painful.

A session committed `2396 files / 329k deletions` from a 1-file index **twice in a row** (the second on top of the first), and only recovered because nothing had been pushed — `git reset --mixed` to the prior good commit, worktree intact. This gate catches it before the bad commit exists.

## How

On a `git commit` (detected via the shared shell-command AST parser, not a regex), it counts:

- staged deletions — `git diff --cached --diff-filter=D --name-only`
- tracked files — `git ls-files`

and blocks (exit 2) when deletions ≥ 50 OR deletions / tracked > 0.75. Commits with zero staged deletions, or below both thresholds, pass untouched. Fails **open** on any error — a guard bug must never wedge commits.

## Bypass

- `Allow mass-delete bypass` in a recent user turn — for a genuine large removal (dropping a vendored tree, deleting a retired package).
- `FLEET_SYNC=1` command prefix — cascade commits legitimately replace whole fleet directories.
