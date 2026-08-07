# stop-means-commit-guard

Stop hook. **BLOCKS** ending a turn when the most recent human turn asked to
stop or pause **and** this session's own work is still uncommitted in the
primary checkout.

"Stop" means finish the commit, not freeze wherever the turn happens to be. The
two readings look alike and are not: one ends with the work landed, the other
leaves a half-applied change on disk for the next session to find.

## What it checks

- **The ask.** The first line of the latest HUMAN turn starts with a stop word
  (`halt`, `hold off`, `hold on`, `pause`, `stop`, `wrap up`). A relay from
  another agent does not count, and an inverted instruction is excluded, so
  "don't stop until the tests pass" and "stop once CI is green" both read as
  keep-going.
- **The state.** `git status --porcelain`, narrowed to the paths this session
  authored. A parallel session's in-flight work in the same checkout is not this
  turn's to land.

## Escapes

- A **linked git worktree**, where stacking WIP is sanctioned, the same
  carve-out [`dirty-worktree-stop-guard`](../dirty-worktree-stop-guard/README.md)
  makes.
- The user types `Allow stop-means-commit bypass`.

## Why it exists

The misread already happened: a turn paused with a dirty tree and a red lint
gate, reported that state, and stopped. `dirty-worktree-stop-guard` did not
catch it, because an announced pause is one of its sanctioned escapes. This is
the narrower sibling that closes exactly that escape: the other guard asks "is
the tree clean?", this one asks "was a pause read as permission to leave it
dirty?".
