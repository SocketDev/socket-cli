# Default branch resolution

Fleet repos are mostly on `main`, but legacy or vendored repos still use
`master`. A script that hard-codes one name silently no-ops on the other —
it runs, exits 0, and never touches the branch it meant to.

## The rule

Never hard-code `main` (or `master`) in a script, hook, or CI step. Resolve
the default branch at runtime:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
       | sed 's@^refs/remotes/origin/@@' || echo main)
```

This reads the remote's default branch first, falls back to `main`, and
falls back to `master` only when `main` doesn't resolve either. Apply this
pattern anywhere a default branch name is needed:

- Base-ref resolution for a diff or a PR (`git diff "$BASE"...HEAD`)
- Hook scripts that need to know which branch is canonical
- PR base detection (`gh pr create --base "$BASE"`)
- Worktree creation (`git worktree add -b <branch> ../<repo>-<task> "$BASE"`)

## Why

A script that assumes `main` breaks silently on any repo still using
`master` — no error, only the wrong branch or an empty diff. The
`git symbolic-ref` lookup reads the truth from the remote instead of
guessing, so the same script works across every fleet repo regardless of
its default branch name.

## Enforcement

`.claude/hooks/fleet/default-branch-guard/` (PreToolUse, Bash) blocks a
command that hard-codes `main`/`master` in a scripting context that should
use the lookup instead: literal `BASE=main`/`BASE=master` assignments,
`--base=main`/`--base main` flag values, `DEFAULT_BRANCH=main`/
`MAIN_BRANCH=master`, and heredoc/file writes containing a `main..HEAD` /
`master...HEAD` literal. It also nudges (non-blocking) on a branch rename
that repoints the default branch name, since that operation fails when a
branch by the target name already exists.
