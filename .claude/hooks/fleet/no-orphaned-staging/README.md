# no-orphaned-staging

Stop hook. Fires at turn-end and lists any files that are staged
(`git diff --cached --name-only`) but not yet committed.

## Why

Fleet rule from CLAUDE.md ("Don't leave the worktree dirty"):

> Stage only when you're about to commit. `git add` and `git commit`
> belong on the same line (chained with `&&`) OR in the same Bash
> call. Don't stage as a side-effect of "preparing" — staging is a
> commit-time action.

A turn that ends with staged-but-uncommitted hunks is the failure
mode the rule warns against. Common causes:

1. The agent ran `git add` but forgot the `git commit`.
2. A pre-commit hook failed and left the index half-cooked.
3. The agent staged "for later" — exactly what this rule forbids.

All three look identical to the next session: a populated index of
unknown provenance. The reminder makes the dangling state visible
at the turn that created it.

## Output

Stderr only. Exit code always 0 — informational, never blocks
(Stop hooks can't refuse anything anyway; the turn already ended).

```
[no-orphaned-staging] Turn ended with staged-but-uncommitted files:
  - scripts/foo.mts
  - template/CLAUDE.md
  ... and 3 more

Fleet rule: stage only when about to commit. Either:
  • Run `git commit` to finish the work, OR
  • Run `git reset` to unstage (keep changes in working tree).

CLAUDE.md → "Don't leave the worktree dirty" → "Stage only when
you're about to commit".
```

## Disable

`SOCKET_NO_ORPHANED_STAGING_DISABLED=1` in the env. Use during
intentional mid-refactor pauses or worktree migrations where staged
state is the work-product.
